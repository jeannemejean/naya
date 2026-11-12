// Les vraies dépendances de la cadence de présence (base, IA, atelier). Séparées de presence.ts
// pour que ses tests n'importent ni la base ni l'IA.
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { content } from "@shared/schema";
import { storage } from "../../storage";
import { isAiBlocked } from "../usage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { tendancesPourLeContenu } from "../profils-veille/tri";
import { depsQuotidien } from "../atelier/deps";
import { joursTravailles } from "../campagne/placement";
import { dansPortee, porteeDe } from "../connexions/portee";
import { chargerCarte } from "./carte";
import { choisirRattachement } from "./rattachement";
import type { DepsPresence } from "./presence";

export const depsPresence: DepsPresence = {
  async adn(userId) {
    const d: any = await storage.getBrandDna(userId);
    if (!d) return null;
    // Les piliers : la liste simple, à défaut les noms des piliers détaillés.
    const simples = Array.isArray(d.contentPillars) ? d.contentPillars.filter((x: unknown) => typeof x === "string") : [];
    const detailles = Array.isArray(d.contentPillarsDetailed)
      ? d.contentPillarsDetailed.map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.titre ?? x?.title)).filter((x: unknown) => typeof x === "string")
      : [];
    return {
      contentBandwidth: d.contentBandwidth ?? null,
      platformPriority: d.platformPriority ?? null,
      contentPillars: simples.length ? simples : detailles,
    };
  },
  async projetVisibilite(userId) {
    // Même règle que le rattachement d'une tâche de contenu sans projet : l'unique objectif de
    // visibilité (à défaut de constance) de toute la carte.
    const carte = await chargerCarte(userId, null);
    const { goalId } = choisirRattachement({ projectId: null, type: "content" }, carte);
    return carte.objectifs.find((o) => o.id === goalId)?.projetId ?? null;
  },
  async comptesActifs(userId, projectId) {
    const portee = projectId != null ? porteeDe(await storage.getProject(projectId, userId)) : null;
    return (await storage.getSocialAccounts(userId))
      .filter((c: any) => c.isActive !== false && dansPortee(c, portee))
      .map((c: any) => ({ id: c.id, platform: c.platform }));
  },
  async postsEntre(userId, debut, fin, projectId) {
    const posts = await db.select().from(content).where(and(
      eq(content.userId, userId),
      or(and(gte(content.scheduledFor, debut), lte(content.scheduledFor, fin)), and(gte(content.publishedAt, debut), lte(content.publishedAt, fin))),
    )).orderBy(content.scheduledFor);
    // Mode agence : seuls les posts du même périmètre (marque ou client) que le projet visé.
    const portee = projectId != null ? porteeDe(await storage.getProject(projectId, userId)) : null;
    const clients = new Set((await storage.getProjects(userId, 1000)).filter((p: any) => p.projectKind === "client").map((p) => p.id));
    const porteeDuPost = (p: { projectId: number | null }) => (p.projectId != null && clients.has(p.projectId) ? p.projectId : null);
    return posts.filter((p) => porteeDuPost(p) === portee);
  },
  async propositionsEnAttente(userId, debut, fin) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(content).where(and(
      eq(content.userId, userId), eq(content.origine, "presence"), isNull(content.publishedAt),
      sql`coalesce(${content.postStatus}, '') <> 'posted'`,
      or(gte(content.createdAt, debut), and(gte(content.scheduledFor, debut), lte(content.scheduledFor, fin))),
    ));
    return r?.n ?? 0;
  },
  async estTravaille(userId, debut, fin) {
    return (await joursTravailles(storage as any, userId, debut, fin)).isWorkDay;
  },
  iaBloquee: (userId) => isAiBlocked(userId),
  ia: async (userId, projectId, consigne, plateformes) => callClaudeWithContext({
    userId, projectId, userMessage: consigne, model: CLAUDE_MODELS.smart, max_tokens: 1500, temperature: 0.6,
    // Ce qui marche en ce moment dans le secteur (profils de veille), pour les plateformes visées.
    additionalSystemContext: await tendancesPourLeContenu(userId, projectId, plateformes),
  }),
  creerPost: (valeurs) => storage.createContent(valeurs as any) as any,
  placer: (userId, posts) => depsQuotidien.placer(userId, posts),
};
