// Sorties structurées : le schéma zod (v4) est la seule source de vérité. Il produit le JSON
// Schema envoyé au modèle ET valide la réponse. Jamais de JSON découpé à la main.
import { z } from "zod/v4";
import { callClaudeDetailed, assertNotTruncated } from "../claude";
import type { TaskKind } from "./types";

// Contraintes de bornes non prises en charge par les sorties structurées (zod les revérifie
// de toute façon à la lecture) ; z.int() en émet par défaut (±2^53).
const NON_SUPPORTE = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"]);

// On part de z.toJSONSchema (enum, const, anyOf, items, required conservés tels quels ; le
// transformJSONSchema du SDK 0.78 les fondrait dans `description`, ce qui ne contraint plus le
// modèle). Chaque objet est fermé : les sorties structurées exigent `additionalProperties: false`.
function fermer(n: any): any {
  if (Array.isArray(n)) return n.map(fermer);
  if (n && typeof n === "object") {
    const o: Record<string, any> = {};
    for (const [k, v] of Object.entries(n)) if (!NON_SUPPORTE.has(k)) o[k] = fermer(v);
    if (o.type === "object" || o.properties) o.additionalProperties = false;
    return o;
  }
  return n;
}

export function schemaJson(s: z.ZodType): Record<string, unknown> {
  return fermer(z.toJSONSchema(s));
}

export function lireStructure<T>(s: z.ZodType<T>, texte: string): T {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new Error("structure_invalide: réponse non JSON");
  }
  const r = s.safeParse(brut);
  if (!r.success) throw new Error(`structure_invalide: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`);
  return r.data;
}

export async function genererStructure<T>(o: {
  schema: z.ZodType<T>; system: string; prompt: string; model: string; maxTokens: number;
  taskKind: TaskKind; etape: string; userId?: string; projectId?: number | null;
}): Promise<{ valeur: T; coutEur: number }> {
  const { text, stopReason, coutEur } = await callClaudeDetailed({
    model: o.model, system: o.system, messages: [{ role: "user", content: o.prompt }],
    max_tokens: o.maxTokens, taskKind: o.taskKind, schema: schemaJson(o.schema),
    ...(o.userId ? { userId: o.userId } : {}), projectId: o.projectId ?? null,
  });
  assertNotTruncated(stopReason, o.etape);
  return { valeur: lireStructure(o.schema, text), coutEur };
}
