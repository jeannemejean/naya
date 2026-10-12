/**
 * Contrôle qualité, couche 2 : une relecture par un modèle léger, sur ce que le code ne voit
 * pas (qui écrit et pourquoi, usage réel du déclencheur, ton humain, demande facile).
 *
 * Sa panne ne bloque JAMAIS un message : une réponse illisible vaut « rien à signaler ».
 */
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import type { Defaut } from "./qualite";
import type { BriefProspect } from "./brief";
import type { RoleTouche } from "./doctrine";

/** PURE */
export function parseRelecture(raw: string): Defaut[] {
  let o: any;
  try { o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { return []; }
  if (o?.ok !== false || !Array.isArray(o?.defauts)) return [];
  return o.defauts
    .map((d: any) => (typeof d?.raison === "string" ? d.raison.trim().slice(0, 300) : ""))
    .filter((r: string) => r.length > 0)
    .slice(0, 5)
    .map((raison: string) => ({ code: "relecture" as const, raison }));
}

export async function relire(args: {
  userId: string; projectId: number | null; role: RoleTouche; body: string; subject?: string | null;
  brief: BriefProspect; premiereTouche: boolean;
}): Promise<Defaut[]> {
  const prompt = `Tu relis un message de prospection avant envoi. Réponds par oui ou non à chaque question, et ne signale que les vrais problèmes.

BRIEF : déclencheur « ${args.brief.declencheur?.fait ?? ""} » ; raison « ${args.brief.raison} » ; proposition « ${args.brief.proposition.contenu} ».
RÔLE DE LA TOUCHE : ${args.role}${args.premiereTouche ? " (premier contact)" : ""}
${args.subject ? `OBJET : ${args.subject}\n` : ""}MESSAGE :
${args.body}

QUESTIONS
1. ${args.role === "invitation" ? "On comprend pourquoi cette personne écrit (pas forcément qui elle est, c'est une invitation) ?" : "On comprend qui écrit, ce qu'elle fait et pourquoi elle écrit ?"}
2. ${args.premiereTouche ? "Le déclencheur du brief est-il réellement utilisé ?" : "Le message apporte-t-il quelque chose de neuf (angle, preuve, idée) ?"}
3. La première phrase est-elle impossible à envoyer à quelqu'un d'autre ?
4. Le ton est-il celui d'une personne qui écrit vite et juste, sans lyrisme ni formule d'IA ?
5. S'il y a une demande, peut-on y répondre en trois mots ?

Réponds UNIQUEMENT avec ce JSON (raison = ce qu'il faut corriger, en une phrase) :
{"ok":true,"defauts":[]}  ou  {"ok":false,"defauts":[{"raison":"..."}]}`;
  try {
    const raw = await callClaudeWithContext({
      userId: args.userId, projectId: args.projectId, userMessage: prompt,
      model: CLAUDE_MODELS.fast, max_tokens: 400, temperature: 0, destinataire: "tiers",
    });
    return parseRelecture(raw);
  } catch (e: any) {
    console.warn("[prospection/relecture] relecture indisponible :", e?.message);
    return [];
  }
}
