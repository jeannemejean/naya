// Requêtes Drizzle du module profils de veille. Toute la base du module passe par ici.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { profilComptes, profilPassages, profilPosts, profilAnalyses, profilTendances, type InsertProfilPost, type InsertProfilTendance } from "@shared/schema";
import { REGLES, type PlateformeVeille, type PostFenetre, type TypeMedia, type Structure } from "@shared/profils-veille";
import type { CompteSuivi } from "./collecte";

export const stockageProfils = {
  async comptesSuivis(profilId: number, plateforme: PlateformeVeille): Promise<CompteSuivi[]> {
    return db.select({ id: profilComptes.id, compte: profilComptes.compte, url: profilComptes.url, echecsConsecutifs: profilComptes.echecsConsecutifs })
      .from(profilComptes)
      .where(and(eq(profilComptes.profilId, profilId), eq(profilComptes.plateforme, plateforme), eq(profilComptes.statut, "suivi")))
      .orderBy(profilComptes.id).limit(REGLES.comptesMaxParPlateforme);
  },
  async reserverPassage(profilId: number, plateforme: string, jour: string): Promise<number | null> {
    const [r] = await db.insert(profilPassages).values({ profilId, plateforme, jour }).onConflictDoNothing().returning({ id: profilPassages.id });
    return r?.id ?? null;
  },
  async terminerPassage(id: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(profilPassages).set(patch as any).where(eq(profilPassages.id, id));
  },
  async clesExistantes(profilId: number, cles: string[]): Promise<Set<string>> {
    if (cles.length === 0) return new Set();
    const rows = await db.select({ cle: profilPosts.cle }).from(profilPosts).where(and(eq(profilPosts.profilId, profilId), inArray(profilPosts.cle, cles)));
    return new Set(rows.map((r) => r.cle));
  },
  async enregistrerPosts(rows: InsertProfilPost[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(profilPosts).values(rows).onConflictDoUpdate({
      target: [profilPosts.profilId, profilPosts.cle],
      set: {
        metriques: sql`excluded.metriques`, abonnes: sql`excluded.abonnes`, releveLe: sql`excluded.releve_le`,
        // Un post déjà jugé garde son engagement si le nouveau relevé ne le mesure pas.
        engagement: sql`coalesce(excluded.engagement, ${profilPosts.engagement})`,
        legende: sql`coalesce(excluded.legende, ${profilPosts.legende})`,
      },
    });
  },
  async historiqueCompte(compteId: number): Promise<number[]> {
    const rows = await db.select({ e: profilPosts.engagement }).from(profilPosts)
      .where(and(eq(profilPosts.compteId, compteId), isNotNull(profilPosts.engagement)))
      .orderBy(desc(profilPosts.publieLe)).limit(REGLES.fenetreMediane);
    return rows.map((r) => r.e as number);
  },
  async marquerForts(maj: Array<{ cle: string; fort: boolean | null }>, profilId: number): Promise<void> {
    for (const m of maj) await db.update(profilPosts).set({ fort: m.fort }).where(and(eq(profilPosts.profilId, profilId), eq(profilPosts.cle, m.cle)));
  },
  async majCompte(id: number, patch: { echecsConsecutifs: number; statut?: string }): Promise<void> {
    await db.update(profilComptes).set(patch).where(eq(profilComptes.id, id));
  },
  async depenseDuMois(profilId: number, mois: string): Promise<number> {
    const debut = new Date(`${mois}-01T00:00:00Z`);
    const fin = new Date(debut); fin.setUTCMonth(fin.getUTCMonth() + 1);
    const [a] = await db.select({ s: sql<number>`coalesce(sum(${profilPassages.coutEur}), 0)` }).from(profilPassages)
      .where(and(eq(profilPassages.profilId, profilId), gte(profilPassages.createdAt, debut), lt(profilPassages.createdAt, fin)));
    const [b] = await db.select({ s: sql<number>`coalesce(sum(${profilAnalyses.coutEur}), 0)` }).from(profilAnalyses)
      .where(and(eq(profilAnalyses.profilId, profilId), gte(profilAnalyses.createdAt, debut), lt(profilAnalyses.createdAt, fin)));
    return Number(a?.s ?? 0) + Number(b?.s ?? 0);
  },
  async creerAnalyse(profilId: number, semaine: string): Promise<number | null> {
    const [r] = await db.insert(profilAnalyses).values({ profilId, semaine }).onConflictDoNothing().returning({ id: profilAnalyses.id });
    return r?.id ?? null;
  },
  async majAnalyse(id: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(profilAnalyses).set(patch as any).where(eq(profilAnalyses.id, id));
  },
  async analysesEnAttente() {
    return db.select().from(profilAnalyses).where(eq(profilAnalyses.statut, "lot_soumis"));
  },
  async postsAClasser(profilId: number, depuis: Date, maintenant: Date) {
    const mur = new Date(maintenant.getTime() - REGLES.maturiteHeures * 3600_000);
    return db.select({ id: profilPosts.id, typeMedia: profilPosts.typeMedia, legende: profilPosts.legende }).from(profilPosts)
      .where(and(eq(profilPosts.profilId, profilId), isNull(profilPosts.format), gte(profilPosts.publieLe, depuis), lt(profilPosts.publieLe, mur))) as any;
  },
  async enregistrerFormat(postId: number, format: unknown): Promise<void> {
    await db.update(profilPosts).set({ format }).where(eq(profilPosts.id, postId));
  },
  async postsFenetre(profilId: number, depuis: Date, maintenant: Date): Promise<PostFenetre[]> {
    const mur = new Date(maintenant.getTime() - REGLES.maturiteHeures * 3600_000);
    const rows = await db.select({ cle: profilPosts.cle, compteId: profilPosts.compteId, plateforme: profilPosts.plateforme, typeMedia: profilPosts.typeMedia, format: profilPosts.format, fort: profilPosts.fort })
      .from(profilPosts).where(and(eq(profilPosts.profilId, profilId), gte(profilPosts.publieLe, depuis), lt(profilPosts.publieLe, mur)));
    return rows.map((r) => ({ cle: r.cle, compteId: r.compteId, plateforme: r.plateforme as any, typeMedia: r.typeMedia as TypeMedia, structure: ((r.format as any)?.structure ?? null) as Structure | null, fort: r.fort }));
  },
  async exemples(profilId: number, cles: string[]) {
    if (cles.length === 0) return [];
    const rows = await db.select({ cle: profilPosts.cle, url: profilPosts.url, legende: profilPosts.legende, compteId: profilPosts.compteId, format: profilPosts.format, engagement: profilPosts.engagement })
      .from(profilPosts).where(and(eq(profilPosts.profilId, profilId), inArray(profilPosts.cle, cles))).orderBy(desc(profilPosts.engagement));
    return rows.map((r) => ({ cle: r.cle, url: r.url, legende: r.legende, compteId: r.compteId, accroche: (r.format as any)?.accroche ?? null }));
  },
  async tendancesPrecedentes(profilId: number, semaine: string) {
    return db.select().from(profilTendances).where(and(eq(profilTendances.profilId, profilId), eq(profilTendances.semaine, semaine)));
  },
  async enregistrerTendances(rows: InsertProfilTendance[]): Promise<void> {
    if (rows.length) await db.insert(profilTendances).values(rows).onConflictDoNothing();
  },
};
