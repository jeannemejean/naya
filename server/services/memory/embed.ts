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

// ── Observabilité ───────────────────────────────────────────────────────────────
// Avant : `catch { return null }` avalait tout, et un compte OpenAI à court de crédit a
// laissé TOUTE la mémoire sans vecteur sans qu'aucun journal n'en parle.
export interface EtatEmbeddings {
  dernierSucces?: Date;
  dernierEchec?: { a: Date; raison: string };
}
const etatEmbeddings: EtatEmbeddings = {};
const DERNIER_LOG = new Map<string, number>();
const LOG_THROTTLE_MS = 60_000;

export function lireEtatEmbeddings(): EtatEmbeddings {
  return {
    ...(etatEmbeddings.dernierSucces ? { dernierSucces: etatEmbeddings.dernierSucces } : {}),
    ...(etatEmbeddings.dernierEchec ? { dernierEchec: { ...etatEmbeddings.dernierEchec } } : {}),
  };
}

/** Test uniquement : remet l'état et le throttle à zéro. */
export function _reinitialiserEtatEmbeddings(): void {
  delete etatEmbeddings.dernierSucces;
  delete etatEmbeddings.dernierEchec;
  DERNIER_LOG.clear();
}

const MOT_SUR = /^[A-Za-z0-9_.\-]{1,60}$/;

/** Raison courte et sûre. Ne lit que status / code / type : jamais le message ni la requête. */
export function raisonEchec(err: unknown): string {
  const e = err as any;
  if (e?.name === "EmbedIndisponible") return "indisponible";
  if (e?.name === "EmbedTimeout") return "timeout";
  if (typeof e?.code === "string" && MOT_SUR.test(e.code)) return e.code;
  if (typeof e?.type === "string" && MOT_SUR.test(e.type)) return e.type;
  if (typeof e?.status === "number") return `http_${e.status}`;
  if (typeof e?.code === "string" && /^(ETIMEDOUT|ECONNABORTED)$/.test(e.code)) return "timeout";
  return "erreur";
}

function noterEchec(raison: string): void {
  const maintenant = Date.now();
  etatEmbeddings.dernierEchec = { a: new Date(maintenant), raison };
  const dernier = DERNIER_LOG.get(raison);
  if (dernier === undefined || maintenant - dernier >= LOG_THROTTLE_MS) {
    DERNIER_LOG.set(raison, maintenant);
    console.error("[embed] échec :", raison);
  }
}

function erreurNommee(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

export async function embedTexts(texts: string[], timeoutMs: number = EMBED_TIMEOUT_MS): Promise<number[][] | null> {
  try {
    const { provider, model } = route("embedding");
    let p;
    try {
      p = registry.get(provider); // throw si openai indisponible
    } catch {
      throw erreurNommee("EmbedIndisponible");
    }
    if (!p.embed) throw erreurNommee("EmbedIndisponible");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      p.embed({ texts }, model),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(erreurNommee("EmbedTimeout")), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    etatEmbeddings.dernierSucces = new Date();
    return (res as { vectors: number[][] }).vectors;
  } catch (err) {
    noterEchec(raisonEchec(err));
    return null; // dégradation silencieuse pour l'appelant (timeout, pas de clé, quota, réseau)
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
