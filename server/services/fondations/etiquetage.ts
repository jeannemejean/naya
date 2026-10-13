/**
 * Étiquetage des contenus d'un projet par motivation d'achat (angle) et format créatif.
 */
import type { Routine, Fondations } from "@shared/schema";
import type { ResultatPassage } from "../routines/types";
import { prochainPassageApres } from "../routines/temps";
import { FORMATS_CREATIFS, ANGLE_AUCUN, KIND_ETIQUETAGE, HEURE_ETIQUETAGE_UTC, LIBELLES_FORMATS, JOURS_COUVERTURE } from "./catalogues";
import { lireProposition, statutsDe, type Motivation } from "./sections";

export type Etiquette = { id: number; angle: string; formatCreatif: string | null };

/** Les étiquettes lisibles de la réponse de l'IA ; null si la réponse est illisible. PUR. */
export function lireEtiquettes(reponse: string, ids: Set<number>, cles: Set<string>): Etiquette[] | null {
  const o = lireProposition(reponse);
  if (!Array.isArray(o.etiquettes)) return null;
  const vus = new Set<number>();
  const out: Etiquette[] = [];
  for (const e of o.etiquettes as any[]) {
    const id = Number(e?.id);
    if (!ids.has(id) || vus.has(id)) continue;
    const angle = typeof e?.angle === "string" ? e.angle : "";
    if (angle !== ANGLE_AUCUN && !cles.has(angle)) continue;
    vus.add(id);
    out.push({ id, angle, formatCreatif: (FORMATS_CREATIFS as readonly string[]).includes(e?.format) ? e.format : null });
  }
  return out;
}

// ─── La routine ──────────────────────────────────────────────────────────────
// Même fenêtre que la couverture : un contenu compté là-bas a toujours été étiqueté ici.
const FENETRE_JOURS = JOURS_COUVERTURE;
const PAR_PASSAGE = 25;

export interface DepsEtiquetage {
  storage: {
    getProject(id: number, userId: string): Promise<any>;
    getFondations(userId: string, projectId: number): Promise<Fondations | undefined>;
    getContenusAEtiqueter(userId: string, projectId: number, depuis: Date, limite: number): Promise<Array<{ id: number; title: string; body: string }>>;
    etiqueterContenus(userId: string, rows: Etiquette[]): Promise<number>;
  };
  garde(userId: string): Promise<ResultatPassage | null>;
  ia(userId: string, projectId: number, prompt: string): Promise<string>;
  /** Langue du compte pour les phrases du passage (français par défaut). */
  langue?(userId: string): Promise<"fr" | "en">;
}

const TEXTES = {
  fr: {
    disparu: "Ce projet n'existe plus : étiquetage arrêté.",
    pasValide: "Motivations pas encore validées : rien à étiqueter.",
    rien: "Aucun nouveau contenu à étiqueter.",
    illisible: "Réponse de l'IA illisible : aucun contenu étiqueté.",
    hors: "hors motivations",
    resume: (n: number, m: string[]) => `${n} contenu${n > 1 ? "s" : ""} étiqueté${n > 1 ? "s" : ""} : ${m.join(", ")}.`,
  },
  en: {
    disparu: "This project no longer exists: tagging stopped.",
    pasValide: "Motivations not validated yet: nothing to tag.",
    rien: "No new content to tag.",
    illisible: "Unreadable AI answer: no content tagged.",
    hors: "outside motivations",
    resume: (n: number, m: string[]) => `${n} piece${n > 1 ? "s" : ""} of content tagged: ${m.join(", ")}.`,
  },
};

export function routineEtiquetagePour(p: { userId: string; projectId: number }, maintenant: Date, actif = true) {
  return {
    userId: p.userId, projectId: p.projectId, kind: KIND_ETIQUETAGE,
    cible: { projectId: p.projectId }, cibleCle: `project:${p.projectId}`,
    cadence: "quotidienne", heureUtc: HEURE_ETIQUETAGE_UTC, actif,
    prochainPassage: prochainPassageApres("quotidienne", HEURE_ETIQUETAGE_UTC, maintenant),
  };
}

function consigne(motivations: Motivation[], contenus: Array<{ id: number; title: string; body: string }>): string {
  return `Classe chaque contenu selon la motivation d'achat qu'il travaille et son format créatif.

Motivations (clé : nom — angle) :
${motivations.map((m) => `- ${m.cle} : ${m.nom}${m.angle ? ` — ${m.angle}` : ""}`).join("\n")}
- ${ANGLE_AUCUN} : aucune de ces motivations

Formats possibles : ${FORMATS_CREATIFS.map((f) => `${f} (${LIBELLES_FORMATS[f]})`).join(", ")}, ou null si aucun ne correspond.

Contenus :
${contenus.map((c) => `[${c.id}] ${c.title}\n${c.body.replace(/\s+/g, " ").slice(0, 600)}`).join("\n\n")}

Réponds en JSON strict : {"etiquettes":[{"id":123,"angle":"cle","format":"format ou null"}]}`;
}

export async function executerEtiquetage(routine: Routine, deps: DepsEtiquetage): Promise<ResultatPassage> {
  const projectId = Number((routine.cible as any)?.projectId);
  const projet = Number.isInteger(projectId) ? await deps.storage.getProject(projectId, routine.userId) : null;
  const T = TEXTES[(await deps.langue?.(routine.userId)) ?? "fr"];
  if (!projet) return { statut: "rien_a_faire", resume: T.disparu, desactiver: true };

  const f = await deps.storage.getFondations(routine.userId, projectId);
  const motivations = Array.isArray(f?.motivations) ? (f!.motivations as Motivation[]) : [];
  if (statutsDe(f).motivations !== "valide" || !motivations.length) {
    return { statut: "rien_a_faire", resume: T.pasValide };
  }

  const depuis = new Date(Date.now() - FENETRE_JOURS * 86_400_000);
  const contenus = await deps.storage.getContenusAEtiqueter(routine.userId, projectId, depuis, PAR_PASSAGE);
  if (!contenus.length) return { statut: "rien_a_faire", resume: T.rien };

  const refus = await deps.garde(routine.userId);
  if (refus) return refus;

  const etiquettes = lireEtiquettes(
    await deps.ia(routine.userId, projectId, consigne(motivations, contenus)),
    new Set(contenus.map((c) => c.id)), new Set(motivations.map((m) => m.cle)),
  );
  if (!etiquettes) return { statut: "erreur", resume: T.illisible };
  // Un contenu envoyé mais non classé (oublié, motivation inventée) passe en « aucun » :
  // sinon il serait renvoyé, et payé, chaque jour. L'utilisatrice peut le corriger.
  const classes = new Set(etiquettes.map((e) => e.id));
  for (const c of contenus) if (!classes.has(c.id)) etiquettes.push({ id: c.id, angle: ANGLE_AUCUN, formatCreatif: null });

  const n = await deps.storage.etiqueterContenus(routine.userId, etiquettes);
  const parAngle = new Map<string, number>();
  for (const e of etiquettes) parAngle.set(e.angle, (parAngle.get(e.angle) || 0) + 1);
  const morceaux = motivations.filter((m) => parAngle.has(m.cle)).map((m) => `${parAngle.get(m.cle)} ${m.nom}`);
  if (parAngle.has(ANGLE_AUCUN)) morceaux.push(`${parAngle.get(ANGLE_AUCUN)} ${T.hors}`);
  return {
    statut: "ok",
    resume: T.resume(n, morceaux),
    details: { etiquetes: n },
  };
}
