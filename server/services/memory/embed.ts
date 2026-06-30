import { createHash } from "crypto";
import { route } from "../ai/router";
import { registry } from "../ai/registry";

// ── Cache d'embedding par HASH DE CONTENU ───────────────────────────────────────
// Les prompts longs (brief stratégique, génération de campagne) ré-embeddent souvent
// le MÊME texte (focusText = le prompt). On met le vecteur en cache (clé = sha1 du texte)
// pour ne pas repayer l'aller-retour OpenAI (~300-800 ms) sur le chemin critique.
const EMBED_CACHE = new Map<string, { vec: number[]; expires: number }>();
const EMBED_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const EMBED_CACHE_MAX = 500;

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

// BEST-EFFORT + CACHE. Ne lève JAMAIS : si le provider d'embeddings est absent
// (pas d'OPENAI_API_KEY) ou échoue, renvoie null (la mémoire se dégrade en silence).
export async function embedText(text: string): Promise<number[] | null> {
  const key = hashText(text);
  const hit = EMBED_CACHE.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.vec.slice(); // copie défensive
  }
  const vecs = await embedTexts([text]);
  const vec = vecs ? vecs[0] ?? null : null;
  if (vec) {
    if (EMBED_CACHE.size >= EMBED_CACHE_MAX) {
      // éviction simple du plus ancien inséré
      const oldest = EMBED_CACHE.keys().next().value;
      if (oldest !== undefined) EMBED_CACHE.delete(oldest);
    }
    EMBED_CACHE.set(key, { vec: vec.slice(), expires: Date.now() + EMBED_CACHE_TTL_MS });
  }
  return vec;
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
