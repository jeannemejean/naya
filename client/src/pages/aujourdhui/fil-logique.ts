// Logique pure du fil conducteur à l'écran (spec 2026-11-10, §2 et §3) : le texte « Étape : …,
// 3 tâches sur 7 faites. Objectif : … », l'édition en ligne d'une proposition d'étapes (Ajuster)
// et le regroupement des étapes par objectif sur la page projet. Aucune dépendance React.
import type { LienFil } from "@shared/fil";

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
