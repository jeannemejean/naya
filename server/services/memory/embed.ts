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

export async function embedTexts(texts: string[], timeoutMs: number = EMBED_TIMEOUT_MS): Promise<number[][] | null> {
  try {
    const { provider, model } = route("embedding");
    const p = registry.get(provider); // throw si openai indisponible → catché ci-dessous
    if (!p.embed) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      p.embed({ texts }, model),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("embed timeout")), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    return (res as { vectors: number[][] }).vectors;
  } catch {
    return null; // dégradation silencieuse (timeout, pas de clé, erreur réseau)
  }
}

/**
 * Embedding d'un gros lot (dépôt d'un dossier : 100–400 morceaux). Le délai de 2,5 s d'`embedTexts`
 * est prévu pour UNE requête de recherche : ici on découpe en lots séquentiels, chacun avec son
 * propre délai. Best-effort : un lot en échec donne des `null` pour ses textes seulement.
 * Renvoie toujours un tableau de la même longueur et dans le même ordre que `textes`.
 */
export async function embedTextsParLots(
  textes: string[],
  opts: { taille?: number; timeoutMs?: number } = {},
): Promise<(number[] | null)[]> {
  const taille = Math.max(1, opts.taille ?? 64);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const out: (number[] | null)[] = [];
  for (let i = 0; i < textes.length; i += taille) {
    const lot = textes.slice(i, i + taille);
    const vecs = await embedTexts(lot, timeoutMs);
    for (let j = 0; j < lot.length; j += 1) out.push(vecs?.[j] ?? null);
  }
  return out;
}

// Sérialise un vecteur pour pgvector (littéral SQL "[a,b,c]").
export function toVectorLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}
