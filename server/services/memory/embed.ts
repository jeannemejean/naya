import { route } from "../ai/router";
import { registry } from "../ai/registry";

// Embedding BEST-EFFORT. Ne lève JAMAIS : si le provider d'embeddings est absent
// (pas d'OPENAI_API_KEY → openai non enregistré dans le registre) ou échoue,
// on renvoie null et la mémoire se dégrade en silence (jamais de crash d'appel IA).
export async function embedText(text: string): Promise<number[] | null> {
  const vecs = await embedTexts([text]);
  return vecs ? vecs[0] ?? null : null;
}

const EMBED_TIMEOUT_MS = 2500; // borne le pire cas (réseau OpenAI) dans le chemin critique

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  try {
    const { provider, model } = route("embedding");
    const p = registry.get(provider); // throw si openai indisponible → catché ci-dessous
    if (!p.embed) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      p.embed({ texts }, model),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("embed timeout")), EMBED_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    return (res as { vectors: number[][] }).vectors;
  } catch {
    return null; // dégradation silencieuse (timeout, pas de clé, erreur réseau)
  }
}

// Sérialise un vecteur pour pgvector (littéral SQL "[a,b,c]").
export function toVectorLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}
