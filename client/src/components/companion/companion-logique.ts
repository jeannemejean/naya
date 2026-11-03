// Logique pure du panneau companion : l'agent agit côté serveur, le panneau ne fait
// qu'afficher ce qui a été fait (avec « Annuler ») et ce qui attend sa validation.
import type { ActionFaite, PropositionVue } from "@shared/agent";

/** Annulable tant que `maintenant <= annulableJusqua` : le serveur refuse au-delà de 24 h
 *  strictement (24 h pile passe, 24 h + 1 s est expirée). */
export function etatAnnulation(faite: ActionFaite, maintenant: Date): "annulable" | "expiree" {
  const fin = new Date(faite.annulableJusqua).getTime();
  if (!Number.isFinite(fin)) return "expiree";
  return maintenant.getTime() <= fin ? "annulable" : "expiree";
}

/** Le serveur tient une proposition pour expirée dès `maintenant >= expire_a` (1 h pile = expirée). */
export function etatProposition(p: PropositionVue, maintenant: Date): "en_attente" | "expiree" {
  const fin = new Date(p.expireA).getTime();
  if (!Number.isFinite(fin)) return "expiree";
  return maintenant.getTime() < fin ? "en_attente" : "expiree";
}

// Les jalons vivent sous /api/projects/:id/milestones (couverts par /api/projects).
const PREFIXES_A_INVALIDER = [
  "/api/tasks", "/api/projects", "/api/preferences", "/api/capture",
  "/api/mesure", "/api/memory", "/api/milestone-triggers",
];

/** Prédicat d'invalidation : le client range ces données sous des clés de formes variées
 *  (["/api/tasks", date], ["/api/projects?limit=200"], ["/api/projects/5/milestones"]…). */
export function doitInvalider(queryKey: readonly unknown[]): boolean {
  const tete = queryKey[0];
  if (typeof tete !== "string") return false;
  return PREFIXES_A_INVALIDER.some((p) => tete === p || tete.startsWith(p + "?") || tete.startsWith(p + "/"));
}

/** Raison d'un 409 levé par `apiRequest` (« 409: {"message":"modifiee"} »), si elle est connue. */
export function raisonDeErreur<R extends string>(err: unknown, connues: readonly R[]): R | null {
  if (!(err instanceof Error)) return null;
  const m = /^409:\s*([\s\S]*)$/.exec(err.message);
  if (!m) return null;
  try {
    const raison = JSON.parse(m[1])?.message;
    return (connues as readonly string[]).includes(raison) ? (raison as R) : null;
  } catch {
    return null;
  }
}

export type StatutPropositionUi = "envoi" | "validee" | "annulee" | "ajustee" | "erreur";

/** Propositions affichées qui attendent encore une réponse : à annuler quand l'utilisatrice
 *  écrit un nouveau message (« Ajuster »). */
export function propositionsAAjuster(
  messages: ReadonlyArray<{ propositions?: PropositionVue[] }>,
  statuts: Readonly<Record<number, StatutPropositionUi | undefined>>,
  maintenant: Date,
): number[] {
  const ids: number[] = [];
  for (const m of messages) {
    for (const p of m.propositions ?? []) {
      if (statuts[p.id]) continue;
      if (etatProposition(p, maintenant) === "en_attente") ids.push(p.id);
    }
  }
  return ids;
}

function estFaite(x: any): x is ActionFaite {
  return !!x && Number.isInteger(x.actionId) && typeof x.resume === "string" && typeof x.annulableJusqua === "string";
}
function estProposition(x: any): x is PropositionVue {
  return !!x && Number.isInteger(x.id) && typeof x.resume === "string" && Array.isArray(x.changements) && typeof x.expireA === "string";
}

export interface MessageHistorique {
  role: "user" | "assistant";
  content: string;
  faites: ActionFaite[];
  propositions: PropositionVue[];
  recherches: string[];
}

/** Ligne de GET /api/companion/history → message affichable. Le serveur range
 *  `{ faites, propositions, recherches }` dans `actions` ; l'ancien format (tableau
 *  d'actions que le client exécutait) est ignoré. */
export function messageDepuisHistorique(row: { role: string; content: string; actions?: unknown }): MessageHistorique {
  const a: any = row.actions && typeof row.actions === "object" && !Array.isArray(row.actions) ? row.actions : {};
  return {
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    faites: Array.isArray(a.faites) ? a.faites.filter(estFaite) : [],
    propositions: Array.isArray(a.propositions) ? a.propositions.filter(estProposition) : [],
    recherches: Array.isArray(a.recherches) ? a.recherches.filter((r: unknown): r is string => typeof r === "string") : [],
  };
}
