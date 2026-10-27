// Atelier — une note à Naya sur un post (retour de Jeanne, 27 oct.) : « ce post a déjà été
// programmé », « plus d'actualité », ou une phrase libre. Naya en tire l'une de trois suites :
// - réécrire le post selon la note (le sujet tient, la forme non) ;
// - le remplacer par un autre post, même créneau, même objectif (le sujet ne tient plus) ;
// - le supprimer sans remplaçant (la note le demande).
// Les deux motifs prêts à cliquer ne demandent aucun appel IA : le post est remplacé. Une note
// libre est lue par le modèle ; sans avis lisible, Naya réécrit (la suite la moins destructrice).
import { z } from "zod/v4";
import { etatPost } from "@shared/atelier";
import type { ResultatRedaction } from "./redaction";
import type { ResultatRefusPost } from "../refus-post/service";

export const MOTIFS_NOTE = ["deja_programme", "plus_actuel"] as const;
export type MotifNote = typeof MOTIFS_NOTE[number];
export type ActionNote = "reecrire" | "remplacer" | "supprimer";

export const NOTE_MAX = 1000;

export const SCHEMA_NOTE = z.object({
  action: z.enum(["reecrire", "remplacer", "supprimer"]),
  consigne: z.string(),
  apprendre: z.boolean(),
});
export type SortieNote = z.infer<typeof SCHEMA_NOTE>;

export interface DecisionNote {
  action: ActionNote;
  /** Ce que Naya fait du post (réécrire) ou ce que le remplaçant doit éviter (remplacer). */
  consigne: string;
  /** La note dit quelque chose de durable sur la marque : elle va dans la mémoire. */
  souvenir: boolean;
}

/** Le corps de la requête : un motif connu et/ou une note, jamais rien. null si invalide. */
export function lireNote(body: unknown): { motif: MotifNote | null; note: string } | null {
  const o = (body ?? {}) as Record<string, unknown>;
  const motif = o.motif == null ? null : o.motif;
  if (motif !== null && !(MOTIFS_NOTE as readonly unknown[]).includes(motif)) return null;
  if (o.note != null && typeof o.note !== "string") return null;
  const note = (typeof o.note === "string" ? o.note : "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  if (!motif && !note) return null;
  return { motif: motif as MotifNote | null, note };
}

const CONSIGNES_MOTIF: Record<MotifNote, string> = {
  deja_programme: "Ce post a déjà été programmé ou publié par ailleurs : propose un autre sujet, vraiment différent, qui sert le même objectif.",
  plus_actuel: "Ce post n'est plus d'actualité : propose un sujet qui l'est, au service du même objectif.",
};

/** Un motif prêt à cliquer : la suite est connue, sans appel IA. */
export function decisionDuMotif(motif: MotifNote, note: string): DecisionNote {
  return { action: "remplacer", consigne: [CONSIGNES_MOTIF[motif], note].filter(Boolean).join(" "), souvenir: false };
}

/** L'avis du modèle sur une note libre ; sans avis lisible, on réécrit selon la note. */
export function normaliserDecisionNote(sortie: SortieNote | null, note: string): DecisionNote {
  if (!sortie) return { action: "reecrire", consigne: note, souvenir: false };
  const consigne = (sortie.consigne ?? "").replace(/\s+/g, " ").trim() || note;
  return { action: sortie.action, consigne, souvenir: sortie.apprendre === true && sortie.action !== "reecrire" };
}

export const SYSTEME_NOTE = [
  "Tu es Naya. L'utilisatrice a laissé une note sur un de ses posts prévus. Décide de la suite :",
  "- reecrire : le sujet tient, c'est le texte qu'il faut changer (ton, longueur, angle, une info à corriger) ;",
  "- remplacer : le sujet ne tient plus (déjà publié ou programmé ailleurs, plus d'actualité, hors sujet pour la marque) : un autre post prend sa place, même jour, même objectif ;",
  "- supprimer : la note demande de retirer ce post sans le remplacer (trop de posts, plus besoin).",
  "consigne : pour reecrire, ce qu'il faut changer, en une phrase (300 caractères au plus) ; pour remplacer, ce que le remplaçant doit faire autrement ; pour supprimer, une phrase vide.",
  "apprendre : vrai seulement si la note dit une préférence durable de la marque (un ton, un sujet à éviter), faux pour un fait ponctuel (déjà programmé, une date).",
  "Dans le doute entre réécrire et remplacer, réécris.",
].join("\n");

export function promptNote(post: { title?: string | null; body?: string | null; platform?: string | null; scheduledFor?: Date | string | null }, note: string): string {
  return [
    `Le post : « ${post.title ?? ""} » — ${post.platform ?? "?"}, prévu le ${post.scheduledFor ? new Date(post.scheduledFor).toISOString().slice(0, 10) : "?"}.`,
    "Son texte actuel :",
    (post.body ?? "").slice(0, 2000) || "(pas encore rédigé)",
    "",
    `La note de l'utilisatrice : ${note}`,
  ].join("\n");
}

export interface PostNote {
  id: number; title?: string | null; body?: string | null; platform?: string | null; scheduledFor?: Date | string | null;
  publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null; autoPost?: boolean | null;
  consigne?: string | null; campaignId?: number | null; tendanceProjetId?: number | null;
}

export interface DepsNote {
  lirePost(id: number, userId: string): Promise<PostNote | undefined>;
  /** null : la dépense est permise. */
  garde(userId: string): Promise<unknown | null>;
  decider(userId: string, post: PostNote, note: string): Promise<SortieNote | null>;
  /** Les sujets des autres posts prévus autour : le remplaçant ne les reprend pas. */
  autresSujets(userId: string, post: PostNote): Promise<string[]>;
  devalider(userId: string, id: number): Promise<{ statut: string }>;
  refaire(userId: string, id: number, consigne: string): Promise<ResultatRedaction>;
  refuser(userId: string, id: number, o: { explication: string | null; remplacer: boolean; souvenir: boolean }): Promise<ResultatRefusPost>;
}

export type ResultatNote =
  | { statut: "introuvable" | "deja_publie" | "refus" | "erreur" }
  | { statut: "reecrit"; body: string }
  | { statut: "remplace"; remplacement: { id: number; title: string } }
  | { statut: "supprime"; remplacementEchoue: boolean };

const EN_COURS = ["uploading", "processing", "posting"];

const publieOuEnCours = (p: PostNote) => etatPost(p) === "publie" || EN_COURS.includes((p.postStatus ?? "").toLowerCase());

/** Supprimer un post depuis l'atelier : sans remplaçant, sans rien mémoriser. */
export async function supprimerPostAtelier(deps: DepsNote, userId: string, id: number): Promise<ResultatNote> {
  const post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  if (publieOuEnCours(post)) return { statut: "deja_publie" };
  const r = await deps.refuser(userId, id, { explication: null, remplacer: false, souvenir: false });
  if (r.statut !== "refuse") return { statut: r.statut };
  return { statut: "supprime", remplacementEchoue: false };
}

export async function traiterNote(deps: DepsNote, userId: string, id: number, { motif, note }: { motif: MotifNote | null; note: string }): Promise<ResultatNote> {
  const post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  if (publieOuEnCours(post)) return { statut: "deja_publie" };

  let decision: DecisionNote;
  if (motif) decision = decisionDuMotif(motif, note);
  else {
    if (await deps.garde(userId)) return { statut: "refus" };
    const sortie = await deps.decider(userId, post, note).catch((e: any) => {
      console.error(`[atelier] note sur le post ${id} :`, e?.message ?? e);
      return null;
    });
    decision = normaliserDecisionNote(sortie, note);
  }

  if (decision.action === "reecrire") {
    if (await deps.garde(userId)) return { statut: "refus" };
    // Un post validé redevient brouillon : il ne partira pas avec l'ancien texte.
    if (etatPost(post) === "valide") {
      const d = await deps.devalider(userId, id);
      if (d.statut !== "brouillon") return { statut: d.statut === "introuvable" ? "introuvable" : "deja_publie" };
    }
    const r = await deps.refaire(userId, id, decision.consigne);
    if (r.statut === "redige") return { statut: "reecrit", body: r.body };
    if (r.statut === "introuvable" || r.statut === "refus") return { statut: r.statut };
    return { statut: "erreur" };
  }

  if (decision.action === "supprimer") {
    const r = await deps.refuser(userId, id, { explication: note || null, remplacer: false, souvenir: decision.souvenir });
    if (r.statut !== "refuse") return { statut: r.statut };
    return { statut: "supprime", remplacementEchoue: false };
  }

  if (await deps.garde(userId)) return { statut: "refus" };
  const autres = (await deps.autresSujets(userId, post).catch(() => [] as string[])).filter(Boolean).slice(0, 15);
  const explication = [
    decision.consigne,
    autres.length ? `Déjà prévus autour, à ne pas reprendre : ${autres.map((t) => `« ${t} »`).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
  const r = await deps.refuser(userId, id, { explication, remplacer: true, souvenir: decision.souvenir });
  if (r.statut !== "refuse") return { statut: r.statut };
  const rempl = r.remplacement as { id?: unknown; title?: unknown } | null;
  if (rempl && typeof rempl.id === "number") {
    return { statut: "remplace", remplacement: { id: rempl.id, title: typeof rempl.title === "string" ? rempl.title : "" } };
  }
  return { statut: "supprime", remplacementEchoue: true };
}
