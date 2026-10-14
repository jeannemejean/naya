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

/** Un élément qui lève est journalisé, les suivants passent quand même. Renvoie le nombre de réussites. */
async function chacun<T>(nom: string, elements: T[], f: (x: T) => Promise<unknown>): Promise<number> {
  let n = 0;
  for (const x of elements) {
    try { await f(x); n++; } catch (e: any) { console.error(`[profils-veille] ${nom} :`, e?.message ?? e); }
  }
  return n;
}

const MAX_RATTACHEMENTS_PAR_TOUR = 10;

/**
 * Les projets à ranger ce tour-ci : jamais tentés d'abord, puis la tentative la plus ancienne ;
 * jamais deux fois le même jour. Un projet qui échoue chaque jour passe donc derrière les autres
 * au lieu de les bloquer. `tentatives` : projectId → jour UTC de la dernière tentative.
 */
export function selectionnerARattacher<T extends { projectId: number }>(candidats: T[], tentatives: Map<number, string>, jour: string, max = MAX_RATTACHEMENTS_PAR_TOUR): T[] {
  return candidats
    .map((c, i) => ({ c, i, t: tentatives.get(c.projectId) ?? "" }))
    .filter((x) => x.t !== jour)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i))
    .slice(0, max)
    .map((x) => x.c);
}

/** Le rattachement (IA + recherche payantes) ne concerne que les utilisatrices pour qui la diffusion est ouverte. */
export async function utilisatricesOuvertes(userIds: string[], estOuvert: (userId: string) => Promise<boolean>): Promise<string[]> {
  const out: string[] = [];
  for (const u of userIds) if (await estOuvert(u).catch(() => false)) out.push(u);
  return out;
}

// Un rattachement ou un tri qui échoue n'écrit rien : sans ces garde-fous, il serait retenté
// (avec appel IA payant) à chaque tour de 15 minutes. État en mémoire du processus.
let dernierRattachement: string | null = null; // jour UTC (AAAA-MM-JJ) du dernier passage
let dernierTriHeure: string | null = null; // heure UTC (AAAA-MM-JJTHH) du dernier passage
const tentativesRattachement = new Map<number, string>(); // projectId → jour UTC de la dernière tentative

export function _reinitialiserTour(): void {
  dernierRattachement = null;
  dernierTriHeure = null;
  tentativesRattachement.clear();
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
      const choisis = selectionnerARattacher(await deps.projetsARattacher(), tentativesRattachement, jourUtc);
      return chacun("rattachement", choisis, (p) => { tentativesRattachement.set(p.projectId, jourUtc); return deps.rattacher(p); });
    });
  }
  if (REGLES.joursCollecteUtc.includes(jour) && heure >= REGLES.heureCollecteUtc) {
    await etape("collectes", compte, async () => {
      const paires = (await deps.profilsCollectables()).flatMap((p) => PLATEFORMES_LOT1.map((pl) => ({ p, pl })));
      return chacun("collecte", paires, ({ p, pl }) => deps.collecter(p.id, pl, maintenant));
    });
  }
  if (jour === REGLES.jourAnalyseUtc && heure >= REGLES.heureAnalyseUtc) {
    await etape("analyses", compte, async () => {
      return chacun("analyse", await deps.profilsCollectables(), (p) => deps.lancerAnalyse(p, semaineAnalysee(maintenant), maintenant));
    });
    await etape("purge", compte, () => deps.purger(maintenant));
  }
  await etape("finalisations", compte, async () => {
    return chacun("finalisation", await deps.analysesEnAttente(), (a) => deps.finaliser(a));
  });
  const heureUtc = iso.slice(0, 13);
  if (dernierTriHeure !== heureUtc) {
    dernierTriHeure = heureUtc;
    await etape("tris", compte, async () => {
      const semaine = semaineDe(maintenant);
      return chacun("tri", await deps.rattachementsATrier(), (r) => deps.trier(r, semaine, maintenant));
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
