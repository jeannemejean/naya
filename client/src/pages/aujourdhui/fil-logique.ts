// Logique pure du fil conducteur à l'écran (spec 2026-11-10, §2 et §3) : le texte « Étape : …,
// 3 tâches sur 7 faites. Objectif : … », l'édition en ligne d'une proposition d'étapes (Ajuster)
// et le regroupement des étapes par objectif sur la page projet. Aucune dépendance React.
import { sensIndicateur, type Indicateur, type LienFil, type MatinFil } from "@shared/fil";

type Traduire = (cle: string, opts?: Record<string, unknown>) => string;

/** « Étape : être visible sur LinkedIn, 3 tâches sur 7 faites. Objectif : 3 nouveaux clients d'ici fin décembre ». */
export function texteLien(l: LienFil, t: Traduire): string {
  const objectif = l.cible?.trim() || l.objectifTitre;
  if (!l.etapeTitre) return t("filConducteur.lien.objectifSeul", { objectif });
  if (l.etapePrevues <= 0) return t("filConducteur.lien.sansAvancement", { etape: l.etapeTitre, objectif });
  const avancement = t(l.etapeFaites < 2 ? "filConducteur.lien.avancementUn" : "filConducteur.lien.avancement",
    { faites: l.etapeFaites, prevues: l.etapePrevues });
  return t("filConducteur.lien.avecAvancement", { etape: l.etapeTitre, avancement, objectif });
}

// ── Propositions ─────────────────────────────────────────────────────────────────────

export type EtatEtape = "faite" | "en_cours" | "a_venir";
export interface EtapeEditable { titre: string; pourquoi: string; etat: EtatEtape }

/** Une proposition ouverte du fil, telle que la rend GET /api/fil/propositions. */
export interface PropositionFil {
  id: number;
  outil: "proposer_etapes" | "rattacher_chaine" | string;
  arguments: Record<string, unknown>;
  changements: Array<{ libelle: string; avant: string | null; apres: string | null }>;
  expireA: string;
  objectif: { id: number; titre: string; projetId: number } | null;
}

const ETATS: readonly EtatEtape[] = ["faite", "en_cours", "a_venir"];
export const ETAPES_MIN = 3;
export const ETAPES_MAX = 6;

/** Les étapes d'une proposition `proposer_etapes`, lues dans ses arguments. */
export function etapesDeProposition(p: PropositionFil): EtapeEditable[] {
  const brutes = Array.isArray((p.arguments as any)?.etapes) ? ((p.arguments as any).etapes as unknown[]) : [];
  return brutes.filter((b): b is Record<string, unknown> => !!b && typeof b === "object").map((b) => ({
    titre: typeof b.titre === "string" ? b.titre : "",
    pourquoi: typeof b.pourquoi === "string" ? b.pourquoi : "",
    etat: ETATS.includes(b.etat as EtatEtape) ? (b.etat as EtatEtape) : "a_venir",
  }));
}

export const renommer = (l: EtapeEditable[], i: number, titre: string) => l.map((e, j) => (j === i ? { ...e, titre } : e));
export const supprimer = (l: EtapeEditable[], i: number) => l.filter((_, j) => j !== i);
export const ajouter = (l: EtapeEditable[]): EtapeEditable[] => [...l, { titre: "", pourquoi: "", etat: "a_venir" }];

/** Échange l'étape i avec sa voisine (sens -1 : remonte). Hors bornes : liste inchangée. */
export function deplacer(l: EtapeEditable[], i: number, sens: -1 | 1): EtapeEditable[] {
  const j = i + sens;
  if (i < 0 || i >= l.length || j < 0 || j >= l.length) return l;
  const copie = [...l];
  [copie[i], copie[j]] = [copie[j], copie[i]];
  return copie;
}

/** 3 à 6 étapes, toutes titrées : sinon le serveur refuserait. */
export const ajustementPret = (l: EtapeEditable[]) =>
  l.length >= ETAPES_MIN && l.length <= ETAPES_MAX && l.every((e) => e.titre.trim().length > 0);

/** Corps de POST /api/fil/propositions/:id/ajuster : la liste éditée, telle quelle (le serveur juge l'ordre). */
export const corpsAjustement = (l: EtapeEditable[]) => ({ etapes: l });

/** Corps de « Refaire » : la proposition remplacée, et la note si elle n'est pas vide. */
export function corpsRefaire(remplace: number, note: string): { remplace: number; note?: string } {
  const n = note.trim();
  return n ? { remplace, note: n } : { remplace };
}

// ── Erreurs ──────────────────────────────────────────────────────────────────────────

/** Code d'erreur d'une réponse d'apiRequest (« 409: {"message":"ordre_etats"} »), ou null. */
export function codeErreur(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const m = /^\d{3}:\s*([\s\S]*)$/.exec(err.message);
  if (!m) return null;
  try {
    const code = JSON.parse(m[1])?.message;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

const CODES_CONNUS = new Set([
  "nombre_etapes", "ordre_etats", "titre_invalide", "etat_invalide", "chaine_en_cours", "deja_en_attente",
  "generation_impossible", "objectif_inactif", "introuvable", "expiree", "deja_traitee", "ai_monthly_limit_reached",
]);

export const cleErreurFil = (code: string | null | undefined) =>
  `filConducteur.erreurs.${code && CODES_CONNUS.has(code) ? code : "erreur"}`;

// ── Le matin ─────────────────────────────────────────────────────────────────────────

/** Le matin du fil (GET /api/fil/matin) : à rafraîchir après une action du fil ou un cochage. */
export const CLE_FIL_MATIN = ["/api/fil/matin"];

export type EtatMatinFil = { actif: boolean; fil: MatinFil | null };

/**
 * Lecture du matin du fil. Hors interrupteur (404) : `actif: false`, sans erreur ; une fois
 * cela su (`connu`), plus aucune requête, même après une invalidation.
 */
export async function chargerMatinFil(connu: EtatMatinFil | undefined, recuperer: () => Promise<Response>): Promise<EtatMatinFil> {
  if (connu?.actif === false) return connu;
  const res = await recuperer();
  if (res.status === 404) return { actif: false, fil: null };
  if (!res.ok) throw new Error(`${res.status}`);
  return { actif: true, fil: (await res.json()) as MatinFil };
}

/** « 2 tâches du jour ne sont rattachées à aucun objectif. » */
export const texteNonRattachees = (n: number, t: Traduire) =>
  t(n < 2 ? "filConducteur.matin.nonRattacheesUn" : "filConducteur.matin.nonRattachees", { n });

/** Après « Annuler » la journée allégée : les tâches déplacées à la main entre-temps restent. */
export const texteNonRemises = (n: number, t: Traduire) =>
  t(n < 2 ? "filConducteur.matin.allegement.nonRemisesUn" : "filConducteur.matin.allegement.nonRemises", { n });

const CODES_ANNULATION = new Set(["expiree", "deja_annulee", "modifiee"]);

/** Clé du message d'un refus d'annulation (409) ; les autres codes passent par cleErreurFil. */
export const cleErreurAnnulation = (code: string | null | undefined) =>
  code && CODES_ANNULATION.has(code) ? `filConducteur.matin.allegement.erreurs.${code}` : cleErreurFil(code);

// ── Le lot 4 au matin (spec §8) ──────────────────────────────────────────────────────

const HEURE_MS = 3600 * 1000;

/**
 * « Veille des appels d'offres : dernier passage réussi il y a 3 jours. » Une durée relative,
 * pas une date : aucune affaire de fuseau ni d'Intl (le mobile n'a pas d'Intl). Moins de 48 h :
 * en heures ; au-delà, en jours. Sans passage réussi connu (ou date illisible) : on le dit.
 */
export function textePanne(p: { nom: string; dernierSucces: string | null }, maintenant: Date, t: Traduire): string {
  const d = p.dernierSucces ? Date.parse(p.dernierSucces) : NaN;
  if (!Number.isFinite(d)) return t("filConducteur.matin.pannes.jamais", { nom: p.nom });
  const heures = Math.max(0, Math.floor((maintenant.getTime() - d) / HEURE_MS));
  if (heures < 1) return t("filConducteur.matin.pannes.recent", { nom: p.nom });
  if (heures < 48) return t("filConducteur.matin.pannes.heures", { nom: p.nom, n: heures });
  return t("filConducteur.matin.pannes.jours", { nom: p.nom, n: Math.floor(heures / 24) });
}

/**
 * Le détail d'un indicateur : sa valeur avec son sens (↑ ↓ =), la valeur précédente quand il y
 * en a une, ou « indisponible (raison) ». Jamais un chiffre inventé pour une source absente.
 */
export function detailIndicateur(i: Indicateur, t: Traduire): { valeur: string; avant: string | null } {
  const avant = i.precedente == null ? null : t("filConducteur.matin.indicateurs.avant", { valeur: i.precedente });
  if (i.indisponible || i.valeur == null) {
    const valeur = i.indisponible
      ? t("filConducteur.matin.indicateurs.indisponibleRaison", { raison: i.indisponible })
      : t("filConducteur.matin.indicateurs.indisponible");
    return { valeur, avant };
  }
  const sens = sensIndicateur(i);
  return { valeur: `${i.valeur}${sens ? ` ${sens}` : ""}`, avant };
}

/** Les `n` jours ouvrés (lundi à vendredi) qui suivent `jour` (YYYY-MM-DD, calcul en UTC). */
export function joursTravaillesApres(jour: string, n: number): string[] {
  const res: string[] = [];
  const d = new Date(`${jour}T12:00:00Z`);
  while (res.length < n && Number.isFinite(d.getTime())) {
    d.setUTCDate(d.getUTCDate() + 1);
    const j = d.getUTCDay();
    if (j !== 0 && j !== 6) res.push(d.toISOString().slice(0, 10));
  }
  return res;
}

export type GesteTrancher = "faire" | "deplacer" | "abandonner";

/** Corps de POST /api/fil/trancher : la date ne part qu'avec « déplacer ». */
export function corpsTrancher(tacheId: number, geste: GesteTrancher, date?: string): { tacheId: number; geste: GesteTrancher; date?: string } {
  return geste === "deplacer" && date ? { tacheId, geste, date } : { tacheId, geste };
}

const CODES_TRANCHER = new Set(["deja_tranchee", "date_passee", "task_not_found"]);

/** Clé du message d'un refus de trancher ; les autres codes passent par cleErreurFil. */
export const cleErreurTrancher = (code: string | null | undefined) =>
  code && CODES_TRANCHER.has(code) ? `filConducteur.matin.cloture.erreurs.${code}` : cleErreurFil(code);

// ── Page projet ──────────────────────────────────────────────────────────────────────

type ObjectifMin = { id: number; title: string; status: string };
type JalonMin = { id: number; goalId?: number | null; status: string };

/** Étapes groupées par objectif actif (ordre reçu conservé) ; les autres jalons forment la chaîne de projet. */
export function grouperParObjectif<O extends ObjectifMin, J extends JalonMin>(jalons: J[], objectifs: O[]) {
  const actifs = objectifs.filter((o) => o.status === "active");
  const ids = new Set(actifs.map((o) => o.id));
  return {
    groupes: actifs.map((objectif) => ({ objectif, jalons: jalons.filter((j) => j.goalId === objectif.id) })),
    sansObjectif: jalons.filter((j) => j.goalId == null || !ids.has(j.goalId)),
  };
}

const CLOSES = new Set(["completed", "skipped"]);

/** « Proposer des étapes » : objectif actif, aucune étape ouverte, aucune proposition d'étapes en attente. */
export function objectifPeutRecevoirEtapes(o: ObjectifMin, jalons: JalonMin[], propositions: PropositionFil[]): boolean {
  if (o.status !== "active") return false;
  if (jalons.some((j) => j.goalId === o.id && !CLOSES.has(j.status))) return false;
  return !propositions.some((p) => p.outil === "proposer_etapes" && p.objectif?.id === o.id);
}
