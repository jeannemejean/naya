// Les vraies sources du suivi de création (base, stockage). Séparées de creation.ts pour que ses
// tests n'importent pas la base.
import { and, eq, gte, lte, or } from "drizzle-orm";
import { db } from "../../db";
import { content } from "@shared/schema";
import { storage } from "../../storage";
import type { DepsCreation } from "./creation";

export const depsCreation: DepsCreation = {
  async comptesActifs(userId) {
    return (await storage.getSocialAccounts(userId))
      .filter((c: any) => c.isActive !== false)
      .map((c: any) => ({ id: c.id, platform: c.platform, nom: c.accountName ?? null, projectId: c.projectId ?? null }));
  },
  async posts(userId, debut, fin) {
    const [posts, projets] = await Promise.all([
      db.select({
        id: content.id, title: content.title, platform: content.platform, socialAccountId: content.socialAccountId,
        scheduledFor: content.scheduledFor, publishedAt: content.publishedAt, postStatus: content.postStatus,
        contentStatus: content.contentStatus, autoPost: content.autoPost, consigne: content.consigne,
        campaignId: content.campaignId, body: content.body, tendanceProjetId: content.tendanceProjetId, projectId: content.projectId,
      }).from(content).where(and(
        eq(content.userId, userId),
        or(and(gte(content.scheduledFor, debut), lte(content.scheduledFor, fin)), and(gte(content.publishedAt, debut), lte(content.publishedAt, fin))),
      )),
      storage.getProjects(userId, 1000),
    ]);
    // Portée d'un post (mode agence, même règle que la présence) : son projet s'il est client, sinon l'utilisatrice.
    const clients = new Set(projets.filter((p: any) => p.projectKind === "client").map((p) => p.id));
    return posts.map(({ projectId, ...p }) => ({ ...p, portee: projectId != null && clients.has(projectId) ? projectId : null }));
  },
  async campagnes(userId) {
    return (await storage.getCampaigns(userId))
      .filter((c) => (c.status ?? "draft") === "draft")
      .map((c) => ({ id: c.id, name: c.name, status: c.status, startDate: c.startDate, duration: c.duration, phases: c.phases }));
  },
};
