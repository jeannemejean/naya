import { db } from "../../db";
import { and, eq, desc } from "drizzle-orm";
import { readingQueries, projects, brandDna, type ReadingQuery } from "@shared/schema";
import { callClaude, CLAUDE_MODELS } from "../claude";
import { retrieveMemories } from "../memory/retrieve";

export const MAX_REQUETES_PAR_PROJET = 6;
export const REGENERATION_JOURS = 7;

/** Régénérer au plus une fois par semaine : sinon la veille change de sujet tous les matins. */
export function doitRegenerer(derniereGeneration: Date | null, today: Date): boolean {
  if (!derniereGeneration) return true;
  const jours = (today.getTime() - derniereGeneration.getTime()) / (24 * 3600 * 1000);
  return jours > REGENERATION_JOURS;
}

/** Lit la sortie du modèle : un tableau de chaînes. Pure, tolérante, plafonnée. */
export function parseRequetes(raw: string): string[] {
  if (!raw) return [];
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return [];
  let brut: any;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const out: string[] = [];
  for (const q of brut) {
    if (typeof q !== "string") continue;
    const s = q.trim();
    if (!s || vues.has(s)) continue;
    vues.add(s);
    out.push(s);
    if (out.length >= MAX_REQUETES_PAR_PROJET) break;
  }
  return out;
}

const PROMPT_REQUETES = `Tu composes des requêtes de veille d'ACTUALITÉ pour une marque.

Règles :
- 3 à 6 requêtes, en français, formulées comme on cherche une actualité récente :
  secteur, acteurs, réglementation, marché — pas des termes génériques de positionnement.
- Pas de « qu'est-ce que », pas de définitions, pas de tutoriels : on cherche ce qui vient
  de se passer, pas de la documentation.
- Chaque requête vise un angle différent. Deux requêtes qui ramèneraient les mêmes
  articles sont une requête gâchée.

Réponds UNIQUEMENT par un tableau JSON de chaînes, sans texte autour : ["...", "..."]`;

/**
 * Rend les requêtes actives d'un projet, en les générant si elles manquent ou ont
 * plus d'une semaine. Best-effort : en cas d'échec de génération, on rend ce qui existe
 * déjà (éventuellement rien) plutôt que de casser la revue.
 */
export async function assurerRequetes(userId: string, projectId: number, today: Date): Promise<string[]> {
  // Lecture protégée : une panne de base ici (connexion, timeout Neon) ne doit jamais
  // faire remonter d'exception — sans état existant fiable, on ne peut de toute façon
  // pas décider une régénération en sécurité (on ignorerait quelles requêtes sont
  // manuelles). On dégrade la revue (liste vide) plutôt que de la casser.
  let existantes: ReadingQuery[];
  try {
    existantes = await db
      .select()
      .from(readingQueries)
      .where(and(eq(readingQueries.userId, userId), eq(readingQueries.projectId, projectId), eq(readingQueries.isActive, true)))
      .orderBy(desc(readingQueries.createdAt));
  } catch (err: any) {
    console.error(`[Lecture] lecture des requêtes projet ${projectId} échouée:`, err?.message);
    return [];
  }

  // La cadence de régénération est pilotée UNIQUEMENT par les requêtes générées par l'IA :
  // sinon une requête manuelle récente (ajoutée ou éditée par l'utilisatrice) repousserait
  // indéfiniment la régénération, alors qu'elle ne doit que se préserver, jamais piloter le rythme.
  const generationsIA = existantes.filter((q) => q.origin === "ai");
  const derniereGeneration = generationsIA.reduce<Date | null>((max, q) => {
    const d = q.createdAt ? new Date(q.createdAt) : null;
    return d && (!max || d > max) ? d : max;
  }, null);

  // Les requêtes écrites à la main ne sont jamais remplacées par la génération.
  const manuelles = existantes.filter((q) => q.origin === "manual").map((q) => q.query);
  if (!doitRegenerer(derniereGeneration, today)) {
    return existantes.map((q) => q.query);
  }

  try {
    const [projet] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!projet) return existantes.map((q) => q.query);
    const adn = await db.select().from(brandDna).where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, projectId))).catch(() => []);
    const mem = await retrieveMemories(userId, projectId, `actualité du marché de ${projet.name}`).catch(() => null);
    const cap = mem?.cap?.map((m) => `- ${m.content}`).join("\n") ?? "";

    const contexte = [
      `Marque : ${projet.name}`,
      projet.type ? `Type : ${projet.type}` : "",
      projet.description ? `Description : ${projet.description}` : "",
      projet.statusNote ? `Où en est la marque : ${projet.statusNote}` : "",
      adn.length ? `ADN de marque : ${JSON.stringify(adn[0]).slice(0, 1500)}` : "",
      cap ? `Ce qui compte pour cette marque :\n${cap}` : "",
    ].filter(Boolean).join("\n");

    const raw = await callClaude({
      model: CLAUDE_MODELS.smart,
      taskKind: "strategic_reasoning",
      system: PROMPT_REQUETES,
      max_tokens: 800,
      userId,
      projectId,
      messages: [{ role: "user", content: contexte }],
    });

    const generees = parseRequetes(raw).filter((q) => !manuelles.includes(q));
    if (generees.length === 0) return existantes.map((q) => q.query);

    // Les anciennes générées sortent, les manuelles restent. Transaction : si l'insert
    // échouait après l'update, le projet se retrouverait avec zéro requête active — le job
    // du lendemain ne trouverait plus rien à chercher pour cette marque.
    await db.transaction(async (tx) => {
      await tx
        .update(readingQueries)
        .set({ isActive: false })
        .where(and(eq(readingQueries.userId, userId), eq(readingQueries.projectId, projectId), eq(readingQueries.origin, "ai")));

      await tx.insert(readingQueries).values(
        generees.map((q) => ({ userId, projectId, query: q, origin: "ai" as const, isActive: true })),
      );
    });

    return [...manuelles, ...generees];
  } catch (err: any) {
    console.error(`[Lecture] génération de requêtes projet ${projectId} échouée:`, err?.message);
    return existantes.map((q) => q.query);
  }
}
