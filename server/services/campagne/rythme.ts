// Le rythme de publication d'une marque dans Naya (17 nov. 2026, spec
// docs/superpowers/specs/2026-11-17-agent-cadence-contenu-design.md).
//
// Une préférence `suivre` de la mémoire (fil `cap`, par projet), au texte préfixé : la génération
// de campagne la lit déjà avec les autres préférences (preferencesDeLaMarque), et le code relit
// le nombre de posts par semaine (lireRythme) pour borner le placement des posts et la cadence de
// présence. Un seul rythme actif par projet : en écrire un nouveau périme le précédent.
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { db } from "../../db";
import { embedText } from "../memory/embed";
import { postsParSemaine } from "../fil/presence";

export const PREFIXE_RYTHME = "Rythme de publication dans Naya : ";
export const RYTHME_MIN = 0.25;
export const RYTHME_MAX = 14;

export function rythmeValide(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= RYTHME_MIN && n <= RYTHME_MAX;
}

/** « Rythme de publication dans Naya : 3 posts par semaine. <précision> » */
export function texteRythme(parSemaine: number, precision?: string): string {
  const nombre = parSemaine.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const base = `${PREFIXE_RYTHME}${nombre} post${parSemaine > 1 ? "s" : ""} par semaine.`;
  const p = precision?.trim();
  return p ? `${base} ${p}` : base;
}

/** Posts par semaine d'un texte de rythme ; null si ce n'est pas un rythme. */
export function lireRythme(texte: string): number | null {
  if (!texte.startsWith(PREFIXE_RYTHME)) return null;
  const reste = texte.slice(PREFIXE_RYTHME.length);
  // Jusqu'au premier point qui n'est pas un séparateur décimal : la précision ne compte pas.
  const fin = reste.search(/\.(\s|$)/);
  return postsParSemaine(fin >= 0 ? reste.slice(0, fin) : reste);
}

const clauseRythme = (userId: string, projectId: number) => and(
  eq(memoryEntries.userId, userId),
  eq(memoryEntries.projectId, projectId),
  eq(memoryEntries.fil, "cap"),
  eq(memoryEntries.entryType, "préférence"),
  isNull(memoryEntries.supersededAt),
  like(memoryEntries.content, `${PREFIXE_RYTHME}%`),
);

export async function rythmeDeLaMarque(
  userId: string, projectId: number,
): Promise<{ id: number; texte: string; parSemaine: number } | null> {
  const [ligne] = await db.select({ id: memoryEntries.id, content: memoryEntries.content })
    .from(memoryEntries).where(clauseRythme(userId, projectId))
    .orderBy(desc(memoryEntries.createdAt), desc(memoryEntries.id)).limit(1);
  if (!ligne) return null;
  const parSemaine = lireRythme(ligne.content);
  return parSemaine == null ? null : { id: ligne.id, texte: ligne.content, parSemaine };
}

export async function ecrireRythme(userId: string, projectId: number, texte: string): Promise<void> {
  // Embedding best-effort, hors transaction : sans vecteur, le rythme est écrit quand même.
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(texte);
  } catch {
    embedding = null;
  }
  await db.transaction(async (tx) => {
    await tx.update(memoryEntries).set({ supersededAt: new Date() }).where(clauseRythme(userId, projectId));
    await tx.insert(memoryEntries).values({
      userId, projectId, fil: "cap", entryType: "préférence", content: texte, salience: 1,
      ...(embedding ? { embedding } : {}),
    });
  });
}

/** Le plafond hebdomadaire d'une marque pour le placement des posts ; null sans rythme. Ne lève pas. */
export async function plafondDeLaMarque(userId: string, projectId: number | null | undefined): Promise<number | null> {
  if (projectId == null) return null;
  try {
    return (await rythmeDeLaMarque(userId, projectId))?.parSemaine ?? null;
  } catch (e: any) {
    console.error(`[rythme] projet ${projectId} non lu :`, e?.message ?? e);
    return null;
  }
}
