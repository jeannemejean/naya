/**
 * Règles de rédaction apprises des corrections de l'utilisatrice.
 *
 * Toutes les SEUIL_EXTRACTION corrections ou écarts sur un projet, Naya lit les paires
 * (version proposée, version retenue) et les raisons d'écart, et en tire de 1 à 5 règles
 * explicites. Elles sont PROPOSÉES : seules les règles acceptées entrent dans les consignes.
 * Rien ne change dans le dos de l'utilisatrice, et rien ne passe d'un projet à l'autre.
 */
import type { ProspectionMessageFeedback } from "@shared/schema";
import { storage } from "../../storage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { normaliserTexte } from "../sequence-distinct";

export const SEUIL_EXTRACTION = 10;
export const RAISONS_ECART = ["trop_long", "pas_mon_ton", "faux", "hors_sujet", "autre"] as const;

export function validerRaisonEcart(r: unknown): boolean {
  return typeof r === "string" && (RAISONS_ECART as readonly string[]).includes(r);
}

/** PURE */
export function parseRegles(raw: string): string[] {
  let o: any;
  try { o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { return []; }
  const vues = new Set<string>();
  const out: string[] = [];
  for (const r of Array.isArray(o?.regles) ? o.regles : []) {
    const t = typeof r === "string" ? r.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const k = normaliserTexte(t);
    if (t.length < 8 || vues.has(k)) continue;
    vues.add(k);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

/** PURE : assez de corrections nouvelles (id > dernierIdTraite) pour une extraction ? */
export function doitExtraire(fb: Array<Pick<ProspectionMessageFeedback, "id" | "action">>, dernierIdTraite: number): boolean {
  return fb.filter((f) => f.id > dernierIdTraite && (f.action === "modifie" || f.action === "ecarte")).length >= SEUIL_EXTRACTION;
}

const enCours = new Set<string>();

/**
 * Appelée après chaque correction ou écart. Ne bloque jamais la requête : à lancer sans
 * attendre (`void extraireSiPret(...)`). Un verrou mémoire évite deux extractions simultanées.
 */
export async function extraireSiPret(userId: string, projectId: number | null): Promise<number> {
  if (projectId == null) return 0;
  const cle = `${userId}:${projectId}`;
  if (enCours.has(cle)) return 0;
  enCours.add(cle);
  try {
    const regles = await storage.getLearnedRules(userId, projectId);
    const dernier = Math.max(0, ...regles.flatMap((r) => r.sourceIds ?? []));
    const fb = await storage.getMessageFeedback(userId, projectId, { sinceId: dernier, limit: 60 });
    if (!doitExtraire(fb, dernier)) return 0;
    const corrections = fb.filter((f) => f.action === "modifie" || f.action === "ecarte");
    const prompt = `Voici des messages de prospection proposés par Naya et ce que l'utilisatrice en a fait (corrigés ou écartés). Déduis-en de 1 à 5 RÈGLES de rédaction explicites, courtes et actionnables, qui expliquent ses corrections (ex. « Ne commence jamais par une formule de politesse », « Cite le client par son nom dès le premier message »). Ne déduis que ce qui revient plusieurs fois. N'invente rien.

${corrections.map((f, i) => `${i + 1}. [${f.role}] ${f.action === "ecarte" ? `ÉCARTÉ (raison : ${f.raison || "non précisée"})` : "CORRIGÉ"}
Proposé : « ${(f.original ?? "").slice(0, 600)} »${f.action === "modifie" ? `\nRetenu : « ${(f.final ?? "").slice(0, 600)} »` : ""}`).join("\n\n")}

Réponds UNIQUEMENT avec ce JSON : {"regles":["..."]}`;
    const raw = await callClaudeWithContext({
      userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.fast, max_tokens: 600, temperature: 0.2, destinataire: "tiers",
    });
    const sourceIds = corrections.map((f) => f.id);
    const textes = parseRegles(raw);
    for (const texte of textes) await storage.createLearnedRule({ userId, projectId, texte, statut: "proposee", sourceIds });
    return textes.length;
  } catch (e: any) {
    console.error("[prospection/regles] extraction échouée :", e?.message);
    return 0;
  } finally {
    enCours.delete(cle);
  }
}
