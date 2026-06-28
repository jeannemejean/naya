import { route } from "../ai/router";
import { registry } from "../ai/registry";

// Embedding BEST-EFFORT. Ne lève JAMAIS : si le provider d'embeddings est absent
// (pas d'OPENAI_API_KEY → openai non enregistré dans le registre) ou échoue,
// on renvoie null et la mémoire se dégrade en silence (jamais de crash d'appel IA).
export async function embedText(text: string): Promise<number[] | null> {
  const vecs = await embedTexts([text]);
  return vecs ? vecs[0] ?? null : null;
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  try {
    const { provider, model } = route("embedding");
    const p = registry.get(provider); // throw si openai indisponible → catché ci-dessous
    if (!p.embed) return null;
    const res = await p.embed({ texts }, model);
    return res.vectors;
  } catch {
    return null; // dégradation silencieuse
  }
}

// Sérialise un vecteur pour pgvector (littéral SQL "[a,b,c]").
export function toVectorLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}
