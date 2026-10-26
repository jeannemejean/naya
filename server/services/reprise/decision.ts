// Reprise des tâches non faites — ce que Naya en fait (spec 2026-10-26-naya-reprise-intelligente-design.md).
//
// Une tâche non faite n'est pas une tâche à pousser d'un jour : c'est un signal. Trop
// grosse (on la découpe), floue (on la reformule), redondante (on la fusionne), dépassée
// (on l'abandonne — archivée, restaurable). Naya en décide avec le contexte complet :
// objectifs et échéances, jalons, façon de travailler, charge des jours qui viennent.
//
// La réponse du modèle n'est jamais crue telle quelle : `normaliserDecisions` garantit une
// décision par tâche, ignore les ids inventés et borne les durées. Sans réponse (panne,
// budget), tout est gardé : le placement reste, lui, intelligent.
import { z } from "zod/v4";

export const ACTIONS = ["garder", "reformuler", "decouper", "fusionner", "abandonner"] as const;
export type ActionReprise = (typeof ACTIONS)[number];

export const SCHEMA_REPRISE = z.object({
  taches: z.array(z.object({
    id: z.number().int(),
    action: z.enum(ACTIONS),
    titre: z.string().nullable(),
    description: z.string().nullable(),
    duree: z.number().int().nullable(),
    sousTaches: z.array(z.object({ titre: z.string(), description: z.string().nullable(), duree: z.number().int() })),
    fusionAvec: z.array(z.number().int()),
    priorite: z.number().int(),
    auPlusTard: z.string().nullable(),
    raison: z.string(),
  })),
});
export type SortieReprise = z.infer<typeof SCHEMA_REPRISE>;

export interface TacheAReprendre {
  id: number;
  title: string;
  description?: string | null;
  estimatedDuration?: number | null;
  priority?: number | null;
  scheduledDate?: string | null;
  createdAt?: Date | string | null;
  learnedAdjustmentCount?: number | null;
  projectId?: number | null;
  goalId?: number | null;
  taskEnergyType?: string | null;
}

export interface Decision {
  id: number;
  action: ActionReprise;
  titre: string | null;
  description: string | null;
  duree: number;
  sousTaches: Array<{ titre: string; description: string | null; duree: number }>;
  /** Tâches de la liste absorbées par celle-ci (action « fusionner »). */
  absorbe: number[];
  /** 1 = la plus urgente pour l'objectif, 3 = peut attendre. */
  priorite: 1 | 2 | 3;
  auPlusTard: string | null;
  raison: string;
}

const borner = (n: unknown, min: number, max: number, defaut: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut;
const texte = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const prioriteDe = (p: number | null | undefined): 1 | 2 | 3 => (p == null ? 2 : p <= 1 ? 1 : p >= 4 ? 3 : 2);

/** Ce que fait la reprise sans avis de Naya : tout garder, tel quel. */
export function decisionParDefaut(t: TacheAReprendre): Decision {
  return {
    id: t.id, action: "garder", titre: null, description: null,
    duree: borner(t.estimatedDuration, 5, 480, 30), sousTaches: [], absorbe: [],
    priorite: prioriteDe(t.priority), auPlusTard: null, raison: "",
  };
}

/**
 * Une décision par tâche reprise, exactement. PUR.
 * - id inconnu, ou déjà absorbé par une fusion → ignoré ;
 * - tâche sans décision → gardée telle quelle ;
 * - « fusionner » sans autre tâche valide à absorber → « reformuler » ;
 * - « decouper » sans au moins deux sous-tâches → « garder » ;
 * - « reformuler » sans titre → « garder » ;
 * - durées bornées, date « au plus tard » valide et pas avant aujourd'hui.
 */
export function normaliserDecisions(taches: TacheAReprendre[], sortie: SortieReprise | null, aujourdhui: string): Decision[] {
  const parId = new Map(taches.map((t) => [t.id, t]));
  const decidees = new Map<number, Decision>();
  const absorbees = new Set<number>();

  for (const d of sortie?.taches ?? []) {
    const t = parId.get(d.id);
    if (!t || decidees.has(d.id) || absorbees.has(d.id)) continue;
    const base = decisionParDefaut(t);
    const auPlusTard = typeof d.auPlusTard === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.auPlusTard) && !Number.isNaN(Date.parse(d.auPlusTard))
      ? (d.auPlusTard < aujourdhui ? aujourdhui : d.auPlusTard) : null;
    const decision: Decision = {
      ...base,
      titre: texte(d.titre, 200) || null,
      description: texte(d.description, 1000) || null,
      duree: borner(d.duree, 5, 480, base.duree),
      priorite: d.priorite <= 1 ? 1 : d.priorite >= 3 ? 3 : 2,
      auPlusTard,
      raison: texte(d.raison, 300),
      action: d.action,
    };

    if (d.action === "fusionner") {
      decision.absorbe = Array.from(new Set(d.fusionAvec)).filter((id) => id !== d.id && parId.has(id) && !decidees.has(id) && !absorbees.has(id));
      if (decision.absorbe.length === 0) decision.action = "reformuler";
    }
    if (decision.action === "decouper") {
      decision.sousTaches = d.sousTaches
        .map((s) => ({ titre: texte(s.titre, 200), description: texte(s.description, 1000) || null, duree: borner(s.duree, 5, 240, 30) }))
        .filter((s) => s.titre)
        .slice(0, 5);
      if (decision.sousTaches.length < 2) { decision.action = "garder"; decision.sousTaches = []; }
    }
    if (decision.action === "fusionner" && !decision.titre) decision.titre = t.title;
    if (decision.action === "reformuler" && !decision.titre && !decision.description && decision.duree === base.duree) decision.action = "garder";
    if (decision.action === "garder" || decision.action === "abandonner" || decision.action === "decouper") {
      decision.titre = null; decision.description = null;
      if (decision.action === "garder") decision.duree = base.duree;
    }

    decidees.set(d.id, decision);
    for (const id of decision.absorbe) absorbees.add(id);
  }

  return taches
    .filter((t) => !absorbees.has(t.id))
    .map((t) => decidees.get(t.id) ?? decisionParDefaut(t));
}

// ─── L'appel ─────────────────────────────────────────────────────────────────────────

export const SYSTEME_REPRISE = [
  "Tu es Naya. Tu reprends les tâches que l'utilisatrice n'a pas faites. Tu ne les pousses pas au lendemain : tu décides ce qui sert le mieux ses objectifs, compte tenu de sa façon de travailler et de la place qu'elle a dans les jours qui viennent.",
  "Pour chaque tâche, une action :",
  "- garder : elle reste juste, on la replace telle quelle ;",
  "- reformuler : le titre (et/ou la description, la durée) change pour qu'elle soit claire et faisable — une action concrète, un verbe, un livrable ;",
  "- decouper : trop grosse ou trop floue pour être commencée ; 2 à 5 sous-tâches concrètes, dans l'ordre, chacune avec sa durée ;",
  "- fusionner : elle fait doublon avec d'autres tâches de la liste ; tu donnes leurs ids dans fusionAvec et le titre de la tâche unique qui les remplace ;",
  "- abandonner : elle ne sert plus aucun objectif, son moment est passé, ou elle est déjà couverte par ce qui a été fait.",
  "Une tâche reportée plusieurs fois est un signal : demande-toi pourquoi elle bloque (trop grosse, floue, plus prioritaire) au lieu de la regarder repartir.",
  "N'abandonne jamais une tâche qui sert un objectif actif sans la remplacer par une meilleure action (reformuler ou découper).",
  "priorite : 1 = ce qui fait avancer l'objectif le plus urgent, 3 = peut attendre. auPlusTard : la date (AAAA-MM-JJ) avant laquelle elle doit être faite pour tenir l'échéance de son objectif, sinon null.",
  "Respecte la charge des jours qui viennent : si tout ne tient pas, priorise, découpe, abandonne le moins utile — l'objectif d'abord.",
  "raison : une phrase, en tutoyant, qui dit pourquoi (ex. « Reportée 4 fois : je l'ai découpée en trois étapes de 20 min. »). Pour garder sans changement, raison peut être vide.",
  "Les titres sont dans la langue des tâches d'origine. Une entrée par tâche principale ; les tâches absorbées par une fusion n'ont pas d'entrée propre.",
].join("\n");

export interface EntreePrompt {
  aujourdhui: string;
  contexte: string;
  taches: Array<TacheAReprendre & { projet?: string | null; objectif?: string | null }>;
  charge: Array<{ jour: string; minutesLibres: number; taches: number }>;
  faitesRecemment: string[];
}

const jourFr = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function promptReprise(e: EntreePrompt): string {
  const lignes = [
    `Aujourd'hui : ${jourFr(e.aujourdhui)} (${e.aujourdhui}).`,
    "",
    "## Ce que tu sais d'elle et de ses objectifs",
    e.contexte.trim() || "(rien)",
    "",
    "## Tâches non faites à reprendre",
    ...e.taches.map((t) => {
      const age = t.createdAt ? Math.max(0, Math.round((Date.parse(e.aujourdhui) - new Date(t.createdAt).getTime()) / 86_400_000)) : null;
      const meta = [
        `${t.estimatedDuration ?? 30} min`,
        t.learnedAdjustmentCount ? `reportée ${t.learnedAdjustmentCount} fois` : null,
        age != null ? `créée il y a ${age} j` : null,
        t.scheduledDate ? `prévue le ${t.scheduledDate}` : null,
        t.projet ? `projet : ${t.projet}` : null,
        t.objectif ? `objectif : ${t.objectif}` : null,
      ].filter(Boolean).join(" · ");
      const desc = (t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      return `#${t.id} ${t.title} (${meta})${desc ? `\n   ${desc}` : ""}`;
    }),
    "",
    "## Place dans les prochains jours ouvrés",
    ...e.charge.map((c) => `${c.jour} (${jourFr(c.jour)}) : ${c.minutesLibres} min libres, ${c.taches} tâche(s) déjà prévue(s)`),
    "",
    "## Fait ces 7 derniers jours",
    ...(e.faitesRecemment.length ? e.faitesRecemment.map((t) => `- ${t}`) : ["(rien de coché)"]),
  ];
  return lignes.join("\n");
}
