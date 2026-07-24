// Lit le message libre écrit par l'utilisateur dans « Où en est ce projet ? » et en
// extrait d'éventuels RITUELS récurrents. N'écrit RIEN : ne fait que proposer.
import { callClaudeDetailed, assertNotTruncated, CLAUDE_MODELS } from "./claude";

export interface RitualProposal {
  kind: "create_ritual";
  title: string;
  days: string;            // "mon,tue,wed,thu,fri"
  startTime: string;       // "HH:MM"
  durationMinutes: number;
}

export interface NoteAnalysis {
  understood: string;
  proposals: RitualProposal[];
}

const VALID_DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/** Une proposition inexploitable est écartée : mieux vaut ne rien proposer qu'un rituel faux. */
function isValidProposal(p: any): p is RitualProposal {
  return (
    p && p.kind === "create_ritual" &&
    typeof p.title === "string" && p.title.trim().length > 0 &&
    typeof p.startTime === "string" && /^\d{2}:\d{2}$/.test(p.startTime) &&
    typeof p.durationMinutes === "number" && p.durationMinutes > 0 && p.durationMinutes <= 480 &&
    typeof p.days === "string" &&
    p.days.split(",").map((d: string) => d.trim().toLowerCase()).every((d: string) => VALID_DAYS.has(d))
  );
}

/** Extrait le premier objet JSON d'une réponse éventuellement entourée de texte. */
function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Réponse illisible du modèle (aucun JSON trouvé).");
  }
  return JSON.parse(text.slice(start, end + 1));
}

const SYSTEM = `Tu analyses une note écrite par un entrepreneur sur l'un de ses projets.

Ta SEULE mission : repérer un ENGAGEMENT RÉCURRENT (« tous les matins », « chaque lundi »,
« toutes les semaines ») qui devrait occuper un créneau protégé dans son planning.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{
  "understood": "une phrase courte, à la 2e personne, disant ce que tu as compris",
  "proposals": [
    { "kind": "create_ritual", "title": "…", "days": "mon,tue,wed,thu,fri",
      "startTime": "HH:MM", "durationMinutes": 20 }
  ]
}

Règles :
- Aucun engagement récurrent → "proposals": [] et un "understood" du type « Noté. Rien à changer dans ton planning. »
- Un événement ponctuel, une décision ou un blocage n'est PAS un rituel → "proposals": [].
- Si l'heure n'est pas précisée mais que le moment l'est (« le matin »), choisis 09:00 pour le matin,
  14:00 pour l'après-midi, 17:00 pour la fin de journée.
- Si la durée n'est pas précisée, mets 30.
- "days" par défaut : "mon,tue,wed,thu,fri".
- Titre court et actionnable, sans guillemets.`;

export async function analyzeStatusNote(opts: {
  userId: string;
  projectId: number;
  note: string;
  projectName: string;
}): Promise<NoteAnalysis> {
  const { text, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.smart,
    system: SYSTEM,
    messages: [{ role: "user", content: `Projet : ${opts.projectName}\n\nNote :\n${opts.note}` }],
    max_tokens: 800,
    userId: opts.userId,
    projectId: opts.projectId,
  });

  assertNotTruncated(stopReason, "analyse de la note projet");

  const parsed = extractJson(text);
  const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.filter(isValidProposal) : [];

  return {
    understood: typeof parsed.understood === "string" ? parsed.understood : "Noté.",
    proposals,
  };
}
