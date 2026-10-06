import { db } from "../../db";
import { sql, and, eq, isNull } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { embedTextsParLots, embedTexts, lireEtatEmbeddings } from "./embed";

/**
 * Rattrapage : indexe les souvenirs restés sans vecteur (embedding NULL) — par exemple après
 * une panne de crédit OpenAI. Dépendances injectées pour être testable sans base.
 */
export interface DepsIndexation {
  chargerManquants(userId: string, max: number): Promise<{ id: number; content: string }[]>;
  /** Un vecteur (ou null) par texte, même ordre. */
  embedder(textes: string[]): Promise<(number[] | null)[]>;
  /** Doit être scopé par id ET user_id. */
  ecrireVecteur(id: number, userId: string, vecteur: number[]): Promise<void>;
  /** Dernière raison d'échec connue du fournisseur d'embeddings. */
  derniereRaison(): string | undefined;
}

export interface ResultatIndexation {
  traites: number;
  indexes: number;
  echecs: number;
  raison?: string;
}

export async function indexerManquants(
  deps: DepsIndexation,
  userId: string,
  opts: { lot?: number; max?: number } = {},
): Promise<ResultatIndexation> {
  const lot = Math.max(1, opts.lot ?? 64);
  const max = Math.max(1, opts.max ?? 2000);
  const lignes = await deps.chargerManquants(userId, max);
  let traites = 0;
  let indexes = 0;
  let echecs = 0;
  let raison: string | undefined;

  for (let i = 0; i < lignes.length; i += lot) {
    const groupe = lignes.slice(i, i + lot);
    const vecteurs = await deps.embedder(groupe.map((l) => l.content));
    let reussis = 0;
    for (let j = 0; j < groupe.length; j += 1) {
      const v = vecteurs[j];
      if (v) {
        try {
          await deps.ecrireVecteur(groupe[j].id, userId, v);
          reussis += 1;
        } catch (e: any) {
          console.error("[Savoir] vecteur non écrit:", e?.message ?? e);
        }
      }
    }
    traites += groupe.length;
    indexes += reussis;
    echecs += groupe.length - reussis;
    if (reussis < groupe.length) raison = deps.derniereRaison() ?? raison;
    // Premier lot totalement en échec : le fournisseur est mort (quota, clé) — on s'arrête là.
    if (i === 0 && reussis === 0) {
      return { traites, indexes, echecs, raison: raison ?? "erreur" };
    }
  }
  return { traites, indexes, echecs, ...(echecs > 0 && raison ? { raison } : {}) };
}

export const depsReelles: DepsIndexation = {
  async chargerManquants(userId, max) {
    return db
      .select({ id: memoryEntries.id, content: memoryEntries.content })
      .from(memoryEntries)
      .where(and(eq(memoryEntries.userId, userId), isNull(memoryEntries.embedding), isNull(memoryEntries.supersededAt)))
      .orderBy(memoryEntries.id)
      .limit(max) as Promise<{ id: number; content: string }[]>;
  },
  embedder: (textes) => embedTextsParLots(textes, { taille: 64, timeoutMs: 30_000 }),
  async ecrireVecteur(id, userId, vecteur) {
    // Tableau brut (colonne `vector` de Drizzle), comme deposer-dossier.ts.
    await db
      .update(memoryEntries)
      .set({ embedding: vecteur } as any)
      .where(and(eq(memoryEntries.id, id), eq(memoryEntries.userId, userId)));
  },
  derniereRaison: () => lireEtatEmbeddings().dernierEchec?.raison,
};

// ── Sonde d'état (cache 5 min) ───────────────────────────────────────────────────
export interface EtatIndex {
  disponible: boolean;
  raison?: string;
  manquants: number;
}
const SONDE_TTL_MS = 5 * 60 * 1000;
let sondeCache: { a: number; disponible: boolean; raison?: string } | null = null;

export function invaliderSonde(): void {
  sondeCache = null;
}

/** Sonde réelle (hors cache d'embedText) : un vrai appel fournisseur, mémorisé 5 min. */
export async function sonderEmbeddings(): Promise<{ disponible: boolean; raison?: string }> {
  if (sondeCache && Date.now() - sondeCache.a < SONDE_TTL_MS) {
    return { disponible: sondeCache.disponible, ...(sondeCache.raison ? { raison: sondeCache.raison } : {}) };
  }
  const vecs = await embedTexts(["ping"], 5000);
  const ok = !!vecs?.[0];
  const raison = ok ? undefined : lireEtatEmbeddings().dernierEchec?.raison ?? "erreur";
  sondeCache = { a: Date.now(), disponible: ok, raison };
  return { disponible: ok, ...(raison ? { raison } : {}) };
}

export async function compterManquants(userId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM memory_entries
    WHERE user_id = ${userId} AND embedding IS NULL AND superseded_at IS NULL
  `);
  return Number((r.rows?.[0] as any)?.n ?? 0);
}
