import { db } from "../../db";
import { sql } from "drizzle-orm";
import { embedText, toVectorLiteral } from "./embed";

export type Fil = "cap" | "founder" | "reception";
export const FILS: Fil[] = ["cap", "founder", "reception"];

// ── Constantes figées (DECISIONS-MEMOIRE-IA.md) ─────────────────────────────────
// Décision 2 — demi-vie de fraîcheur PAR FIL (jours).
const HALF_LIFE_DAYS: Record<Fil, number> = { cap: 180, founder: 45, reception: 10 };
// Décision 6 — Top-K par fil.
const TOP_K: Record<Fil, number> = { cap: 3, founder: 4, reception: 5 };
// Décision 1 — poids de départ (Stanford / Generative Agents) : tous égaux à 1.0.
const W_REL = 1.0, W_IMP = 1.0, W_REC = 1.0;
// Lot de candidats récupérés par ANN avant re-scoring.
const ANN_CANDIDATES = 20;

export interface ScoredMemory {
  id: number;
  fil: Fil;
  content: string;
  entryType: string;
  salience: number;
  ageDays: number;
  score: number;
}

// Décision 2 — recency = décroissance exponentielle, demi-vie propre au fil.
export function recencyScore(ageDays: number, fil: Fil): number {
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS[fil]);
}

function clamp01(x: number | null | undefined): number {
  return Math.max(0, Math.min(1, x ?? 0));
}

// ── CŒUR DU SCORING (Décision 1) ────────────────────────────────────────────────
// SOMME PONDÉRÉE NORMALISÉE (Generative Agents), PAS un produit :
//   score = w_rel·relevance + w_imp·importance + w_rec·recency
//   relevance = similarité cosinus, normalisée min-max sur les candidats
//   importance = salience [0,1] ; recency [0,1] = 0.5^(age_jours / demi_vie(fil))
// La forme additive ne s'effondre pas quand un facteur est proche de 0.
export function scoreCandidates(
  cands: Array<{ id: number; content: string; entryType: string; salience: number; ageDays: number; distance: number | null }>,
  fil: Fil,
): ScoredMemory[] {
  // similarité cosinus = 1 - distance cosinus (pgvector <=>).
  const sims = cands.map((c) => (c.distance == null ? null : 1 - c.distance));
  const known = sims.filter((s): s is number => s != null);
  const min = known.length ? Math.min(...known) : 0;
  const max = known.length ? Math.max(...known) : 0;
  const span = max - min;

  return cands
    .map((c, i) => {
      const s = sims[i];
      // relevance normalisée min-max ; si pas de focus (distance null) → relevance neutre 0.
      const relevance = s == null ? 0 : (span > 1e-9 ? (s - min) / span : 1);
      const importance = clamp01(c.salience);
      const recency = recencyScore(c.ageDays, fil);
      const score = W_REL * relevance + W_IMP * importance + W_REC * recency;
      return { id: c.id, fil, content: c.content, entryType: c.entryType, salience: c.salience, ageDays: c.ageDays, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K[fil]);
}

// ── Récupération par fil (best-effort) ──────────────────────────────────────────
export async function retrieveMemories(
  userId: string,
  projectId?: number | null,
  focusText?: string,
): Promise<{ cap: ScoredMemory[]; founder: ScoredMemory[]; reception: ScoredMemory[] }> {
  const out = { cap: [] as ScoredMemory[], founder: [] as ScoredMemory[], reception: [] as ScoredMemory[] };
  try {
    // Court-circuit perf : si l'utilisateur n'a AUCUNE mémoire, inutile d'embedder
    // (évite un aller-retour OpenAI dans le chemin critique de chaque appel IA).
    const has: any = await db.execute(sql`SELECT 1 FROM memory_entries WHERE user_id = ${userId} AND superseded_at IS NULL LIMIT 1`);
    if ((has.rows ?? has).length === 0) return out;

    // Embedde le focus (sujet de la décision en cours). Best-effort : null = fallback fraîcheur.
    const focusVec = focusText ? await embedText(focusText) : null;
    const vecLit = focusVec ? toVectorLiteral(focusVec) : null;
    for (const fil of FILS) {
      const cands = await fetchCandidates(userId, projectId ?? null, fil, vecLit);
      out[fil] = scoreCandidates(cands, fil);
    }
  } catch {
    /* best-effort : dégradation silencieuse, on renvoie ce qu'on a */
  }
  return out;
}

async function fetchCandidates(
  userId: string,
  projectId: number | null,
  fil: Fil,
  vecLit: string | null,
): Promise<Array<{ id: number; content: string; entryType: string; salience: number; ageDays: number; distance: number | null }>> {
  // Portée : cap/reception scopés à la MARQUE (projectId) ; founder = transverse (projectId null).
  const projScope =
    fil === "founder"
      ? sql`m.project_id IS NULL`
      : sql`m.project_id IS NOT DISTINCT FROM ${projectId}`;
  // Avec focus → tri par distance vectorielle (index HNSW) ; sans focus → fraîcheur.
  const distSel = vecLit ? sql`(m.embedding <=> ${vecLit}::vector)` : sql`NULL`;
  const orderBy = vecLit ? sql`m.embedding <=> ${vecLit}::vector ASC` : sql`m.created_at DESC`;

  const res: any = await db.execute(sql`
    SELECT m.id,
           m.content,
           m.entry_type AS "entryType",
           COALESCE(m.salience, 0.5) AS salience,
           EXTRACT(EPOCH FROM (now() - m.created_at)) / 86400.0 AS "ageDays",
           ${distSel} AS distance
    FROM memory_entries m
    WHERE m.user_id = ${userId}
      AND m.fil = ${fil}
      AND m.superseded_at IS NULL
      AND ${projScope}
    ORDER BY ${orderBy}
    LIMIT ${ANN_CANDIDATES}
  `);
  const rows = res.rows ?? res;
  return rows.map((r: any) => ({
    id: Number(r.id),
    content: r.content,
    entryType: r.entryType,
    salience: Number(r.salience),
    ageDays: Number(r.ageDays),
    distance: r.distance == null ? null : Number(r.distance),
  }));
}
