/**
 * GEO : poser une question à une IA « comme un client le ferait » et récupérer sa réponse et
 * les sources qu'elle cite. Deux moteurs, chacun activé par sa clé :
 *  - OpenAI (ChatGPT) : API Responses avec l'outil de recherche web. OPENAI_API_KEY, déjà
 *    présente pour les embeddings. Modèle : NAYA_GEO_OPENAI_MODEL (défaut gpt-4o-mini).
 *  - Perplexity : API sonar. PERPLEXITY_API_KEY (optionnelle). Modèle : NAYA_GEO_PERPLEXITY_MODEL.
 */
export type Moteur = "openai" | "perplexity";
export interface ReponseMoteur { texte: string; citations: string[] }
type Env = Record<string, string | undefined>;
type Fetch = typeof globalThis.fetch;

export function moteursConfigures(env: Env = process.env): Moteur[] {
  const out: Moteur[] = [];
  if (env.OPENAI_API_KEY) out.push("openai");
  if (env.PERPLEXITY_API_KEY) out.push("perplexity");
  return out;
}

const unique = (xs: string[]) => Array.from(new Set(xs));

export function lireReponseOpenAI(json: any): ReponseMoteur {
  const textes: string[] = [];
  const citations: string[] = [];
  for (const o of Array.isArray(json?.output) ? json.output : []) {
    if (o?.type !== "message" || !Array.isArray(o.content)) continue;
    for (const c of o.content) {
      if (c?.type !== "output_text") continue;
      if (typeof c.text === "string") textes.push(c.text);
      for (const a of Array.isArray(c.annotations) ? c.annotations : []) {
        if (a?.type === "url_citation" && typeof a.url === "string") citations.push(a.url);
      }
    }
  }
  return { texte: textes.join("\n").trim(), citations: unique(citations) };
}

export function lireReponsePerplexity(json: any): ReponseMoteur {
  const texte = typeof json?.choices?.[0]?.message?.content === "string" ? json.choices[0].message.content.trim() : "";
  const brutes: unknown[] = Array.isArray(json?.citations) ? json.citations
    : Array.isArray(json?.search_results) ? json.search_results.map((s: any) => s?.url) : [];
  return { texte, citations: unique(brutes.filter((u): u is string => typeof u === "string")) };
}

const NOM: Record<Moteur, string> = { openai: "OpenAI", perplexity: "Perplexity" };

export async function interrogerMoteur(
  moteur: Moteur,
  prompt: string,
  deps: { fetch?: Fetch; env?: Env } = {},
): Promise<ReponseMoteur> {
  const env = deps.env ?? process.env;
  const fetch = deps.fetch ?? globalThis.fetch;
  const cle = moteur === "openai" ? env.OPENAI_API_KEY : env.PERPLEXITY_API_KEY;
  if (!cle) throw new Error(`${NOM[moteur]} : clé absente`);
  const requete = moteur === "openai"
    ? {
      url: "https://api.openai.com/v1/responses",
      body: { model: env.NAYA_GEO_OPENAI_MODEL || "gpt-4o-mini", input: prompt, tools: [{ type: "web_search_preview" }] },
    }
    : {
      url: "https://api.perplexity.ai/chat/completions",
      body: { model: env.NAYA_GEO_PERPLEXITY_MODEL || "sonar", messages: [{ role: "user", content: prompt }] },
    };
  let res: any;
  try {
    res = await fetch(requete.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(requete.body),
      signal: AbortSignal.timeout(90_000),
    } as any);
  } catch (e: any) {
    throw new Error(`${NOM[moteur]} : erreur réseau (${e?.message || e})`);
  }
  if (!res.ok) {
    const detail = await (res.text?.() ?? Promise.resolve("")).catch(() => "");
    throw new Error(`${NOM[moteur]} : HTTP ${res.status}${detail ? ` (${String(detail).slice(0, 120)})` : ""}`);
  }
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`${NOM[moteur]} : réponse illisible`); }
  return moteur === "openai" ? lireReponseOpenAI(json) : lireReponsePerplexity(json);
}
