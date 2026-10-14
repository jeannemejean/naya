// Le robot des profils de veille : un tour toutes les 15 minutes. Chaque étape est
// idempotente en base (unicité), donc un redémarrage ou une seconde instance ne double rien,
// et une étape manquée à l'heure est rattrapée au tour suivant du même jour.
import { REGLES, PLATEFORMES_LOT1, semaineDe, semaineAnalysee, type PlateformeVeille } from "@shared/profils-veille";

export interface DepsTour {
  projetsARattacher(): Promise<any[]>;
  rattacher(p: any): Promise<string>;
  profilsCollectables(): Promise<Array<{ id: number; nom: string; description: string }>>;
  collecter(profilId: number, plateforme: PlateformeVeille, maintenant: Date): Promise<unknown>;
  lancerAnalyse(profil: { id: number; nom: string; description: string }, semaine: string, maintenant: Date): Promise<string>;
  analysesEnAttente(): Promise<any[]>;
  finaliser(a: any): Promise<string>;
  rattachementsATrier(): Promise<Array<{ userId: string; projectId: number; profilId: number; dernierTri: string | null }>>;
  trier(r: { userId: string; projectId: number; profilId: number; dernierTri: string | null }, semaine: string, maintenant: Date): Promise<string>;
  purger(maintenant: Date): Promise<number>;
}

async function etape(nom: string, compte: Record<string, number>, f: () => Promise<number>) {
  try { compte[nom] = await f(); } catch (e: any) { console.error(`[profils-veille] étape ${nom} :`, e?.message ?? e); compte[nom] = -1; }
}

// Un rattachement ou un tri qui échoue n'écrit rien : sans ces garde-fous, il serait retenté
// (avec appel IA payant) à chaque tour de 15 minutes. État en mémoire du processus.
let dernierRattachement: string | null = null; // jour UTC (AAAA-MM-JJ) du dernier passage
let dernierTriHeure: string | null = null; // heure UTC (AAAA-MM-JJTHH) du dernier passage

export function _reinitialiserTour(): void {
  dernierRattachement = null;
  dernierTriHeure = null;
}

export async function tourProfilsVeille(maintenant: Date, d?: DepsTour): Promise<Record<string, number>> {
  const deps = d ?? (await import("./deps")).depsTour;
  const compte: Record<string, number> = {};
  const jour = maintenant.getUTCDay(), heure = maintenant.getUTCHours();
  const iso = maintenant.toISOString();

  const jourUtc = iso.slice(0, 10);
  if (heure >= REGLES.heureCollecteUtc && dernierRattachement !== jourUtc) {
    dernierRattachement = jourUtc;
    await etape("rattachements", compte, async () => {
      let n = 0; for (const p of await deps.projetsARattacher()) { await deps.rattacher(p); n++; } return n;
    });
  }
  if (REGLES.joursCollecteUtc.includes(jour) && heure >= REGLES.heureCollecteUtc) {
    await etape("collectes", compte, async () => {
      let n = 0;
      for (const p of await deps.profilsCollectables()) for (const pl of PLATEFORMES_LOT1) { await deps.collecter(p.id, pl, maintenant); n++; }
      return n;
    });
  }
  if (jour === REGLES.jourAnalyseUtc && heure >= REGLES.heureAnalyseUtc) {
    await etape("analyses", compte, async () => {
      let n = 0; for (const p of await deps.profilsCollectables()) { await deps.lancerAnalyse(p, semaineAnalysee(maintenant), maintenant); n++; } return n;
    });
    await etape("purge", compte, () => deps.purger(maintenant));
  }
  await etape("finalisations", compte, async () => {
    let n = 0; for (const a of await deps.analysesEnAttente()) { await deps.finaliser(a); n++; } return n;
  });
  const heureUtc = iso.slice(0, 13);
  if (dernierTriHeure !== heureUtc) {
    dernierTriHeure = heureUtc;
    await etape("tris", compte, async () => {
      let n = 0; const semaine = semaineDe(maintenant);
      for (const r of await deps.rattachementsATrier()) { await deps.trier(r, semaine, maintenant); n++; } return n;
    });
  }
  return compte;
}

let enCours = false;
export function scheduleProfilsVeille(): void {
  if (process.env.PROFILS_VEILLE_ROBOT !== "on") {
    console.log('[profils-veille] robot désactivé (PROFILS_VEILLE_ROBOT ≠ "on")');
    return;
  }
  const tick = async () => {
    if (enCours) return;
    enCours = true;
    try { await tourProfilsVeille(new Date()); } finally { enCours = false; }
  };
  setInterval(tick, 15 * 60_000);
  console.log("[profils-veille] robot planifié (toutes les 15 min)");
}
