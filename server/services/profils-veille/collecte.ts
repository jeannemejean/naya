// Un passage de collecte : un profil × une plateforme × un jour. Idempotent (le passage est
// réservé en base avant toute dépense), borné par le plafond mensuel du profil, best-effort.
import { REGLES, engagementDe, estMur, estFort, cleDePost, jourDe, moisDe, type PlateformeVeille } from "@shared/profils-veille";
import type { InsertProfilPost } from "@shared/schema";
import type { ProfilCollecte } from "./collecte/instagram";

export interface CompteSuivi { id: number; compte: string; url: string; echecsConsecutifs: number }

export interface DepsCollecte {
  comptesSuivis(profilId: number, plateforme: PlateformeVeille): Promise<CompteSuivi[]>;
  /** Réserve le passage du jour ; null s'il existe déjà (unicité profil × plateforme × jour). */
  reserverPassage(profilId: number, plateforme: PlateformeVeille, jour: string): Promise<number | null>;
  terminerPassage(id: number, patch: { statut: string; comptes?: number; postsNouveaux?: number; postsMisAJour?: number; echecs?: number; erreur?: string | null; coutEur?: number }): Promise<void>;
  collecter(plateforme: PlateformeVeille, urls: string[]): Promise<any[] | null>;
  lireProfil(raw: any): ProfilCollecte;
  clesExistantes(profilId: number, cles: string[]): Promise<Set<string>>;
  /** Upsert sur (profilId, cle) : métriques, abonnés, engagement, releveLe mis à jour. */
  enregistrerPosts(rows: InsertProfilPost[]): Promise<void>;
  /** Engagements non nuls des posts mûrs du compte, du plus récent au plus ancien (30 au plus). */
  historiqueCompte(compteId: number): Promise<number[]>;
  marquerForts(maj: Array<{ cle: string; fort: boolean | null }>, profilId: number): Promise<void>;
  majCompte(id: number, patch: { echecsConsecutifs: number; statut?: string }): Promise<void>;
  depenseDuMois(profilId: number, mois: string): Promise<number>;
  coutParCompte: number;
}

export type ResultatCollecte =
  | { statut: "deja" } | { statut: "plafond" } | { statut: "erreur"; erreur: string }
  | { statut: "ok"; nouveaux: number; misAJour: number; echecs: number };

export async function collecterProfil(deps: DepsCollecte, profilId: number, plateforme: PlateformeVeille, maintenant: Date): Promise<ResultatCollecte> {
  const passage = await deps.reserverPassage(profilId, plateforme, jourDe(maintenant));
  if (passage == null) return { statut: "deja" };

  if ((await deps.depenseDuMois(profilId, moisDe(maintenant))) >= REGLES.plafondEurParMois) {
    await deps.terminerPassage(passage, { statut: "plafond", erreur: "Plafond mensuel du profil atteint." });
    return { statut: "plafond" };
  }

  const comptes = (await deps.comptesSuivis(profilId, plateforme)).slice(0, REGLES.comptesMaxParPlateforme);
  if (comptes.length === 0) {
    await deps.terminerPassage(passage, { statut: "ok" });
    return { statut: "ok", nouveaux: 0, misAJour: 0, echecs: 0 };
  }

  const lignes = await deps.collecter(plateforme, comptes.map((c) => c.url));
  if (lignes == null) {
    const erreur = "La collecte n'a pas répondu (fournisseur indisponible ou délai dépassé).";
    await deps.terminerPassage(passage, { statut: "erreur", comptes: comptes.length, erreur, coutEur: 0 });
    return { statut: "erreur", erreur };
  }

  const lus = lignes.map((l) => ({ l, p: deps.lireProfil(l) }));
  const pourCompte = (c: CompteSuivi) =>
    lus.find(({ l, p }) => p.compte === c.compte || String(l?.input?.url ?? l?.url ?? "").toLowerCase().includes(`/${c.compte}`));

  const rows: InsertProfilPost[] = [];
  const parCompte = new Map<number, string[]>();
  let echecs = 0;
  for (const c of comptes) {
    const trouve = pourCompte(c);
    if (!trouve || trouve.p.erreur) {
      echecs++;
      const n = c.echecsConsecutifs + 1;
      await deps.majCompte(c.id, n >= REGLES.echecsAvantInjoignable ? { echecsConsecutifs: n, statut: "injoignable" } : { echecsConsecutifs: n });
      continue;
    }
    await deps.majCompte(c.id, { echecsConsecutifs: 0 });
    for (const post of trouve.p.posts) {
      const cle = cleDePost(post.url);
      const mur = estMur(post.publieLe, maintenant);
      rows.push({
        profilId, compteId: c.id, plateforme, url: post.url, cle, publieLe: post.publieLe,
        typeMedia: post.typeMedia, legende: post.legende, metriques: post.metriques, abonnes: trouve.p.abonnes,
        engagement: mur ? engagementDe(plateforme, post.metriques, trouve.p.abonnes) : null, releveLe: maintenant,
      });
      if (mur) parCompte.set(c.id, [...(parCompte.get(c.id) ?? []), cle]);
    }
  }

  const existantes = await deps.clesExistantes(profilId, rows.map((r) => r.cle));
  await deps.enregistrerPosts(rows);

  const forts: Array<{ cle: string; fort: boolean | null }> = [];
  for (const [compteId, cles] of Array.from(parCompte)) {
    const historique = await deps.historiqueCompte(compteId);
    for (const cle of cles) {
      const e = rows.find((r) => r.cle === cle)?.engagement ?? null;
      forts.push({ cle, fort: estFort(e, historique) });
    }
  }
  await deps.marquerForts(forts.filter((f) => f.fort !== null), profilId);

  const nouveaux = rows.filter((r) => !existantes.has(r.cle)).length;
  const collectes = comptes.length - echecs;
  await deps.terminerPassage(passage, {
    statut: "ok", comptes: collectes, postsNouveaux: nouveaux, postsMisAJour: rows.length - nouveaux, echecs,
    coutEur: collectes * deps.coutParCompte,
  });
  return { statut: "ok", nouveaux, misAJour: rows.length - nouveaux, echecs };
}
