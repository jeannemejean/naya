// Requêtes Drizzle du module profils de veille. Toute la base du module passe par ici.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { profilComptes, profilPassages, profilPosts, profilAnalyses, profilTendances, profilsVeille, profilRattachements, tendancesProjet, projects, brandDna, fondations, type InsertProfilPost, type InsertProfilTendance, type InsertTendanceProjet } from "@shared/schema";
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
  async catalogueActif() {
    return db.select({ id: profilsVeille.id, nom: profilsVeille.nom, description: profilsVeille.description, criteres: profilsVeille.criteres })
      .from(profilsVeille).where(eq(profilsVeille.statut, "actif"));
  },
  async enregistrerRattachement(row: { userId: string; projectId: number; profilId: number; confiance: number; raison: string; statut: string }) {
    await db.insert(profilRattachements).values(row).onConflictDoUpdate({
      target: profilRattachements.projectId,
      set: { profilId: row.profilId, confiance: row.confiance, raison: row.raison, statut: row.statut, updatedAt: new Date() },
    });
  },
  async creerProposition(profil: { nom: string; description: string; criteres: unknown }, comptes: Array<{ plateforme: string; compte: string; url: string }>) {
    const [p] = await db.insert(profilsVeille).values({ ...profil, criteres: profil.criteres as any, origine: "naya", statut: "propose" }).returning({ id: profilsVeille.id });
    if (comptes.length) await db.insert(profilComptes).values(comptes.map((c) => ({ ...c, profilId: p.id, origine: "naya", statut: "propose" }))).onConflictDoNothing();
    return p.id;
  },
  /**
   * Projets actifs à (re)ranger : sans rattachement, refusé, ou dont le Brand DNA a changé depuis un
   * rattachement « propose ». Jamais écrasés : « confirme » (choix de l'utilisatrice) et
   * « en_attente » (attend Jeanne). 10 au plus par tour.
   */
  async projetsARattacher(userIds: string[]) {
    const out: Array<{ userId: string; projectId: number; nom: string; dna: any; fond: any; exclus: number[]; rattachementId: number | null }> = [];
    for (const userId of userIds) {
      const projets = await db.select().from(projects).where(and(eq(projects.userId, userId), eq(projects.projectStatus, "active")));
      for (const pr of projets) {
        const [dna] = await db.select().from(brandDna).where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, pr.id))).limit(1);
        if (!dna) continue;
        const [r] = await db.select().from(profilRattachements).where(eq(profilRattachements.projectId, pr.id)).limit(1);
        const aRefaire = !r || r.statut === "refuse" || (r.statut === "propose" && !!dna.updatedAt && !!r.updatedAt && dna.updatedAt > r.updatedAt);
        if (!aRefaire) continue;
        const [fond] = await db.select().from(fondations).where(and(eq(fondations.userId, userId), eq(fondations.projectId, pr.id))).limit(1);
        out.push({ userId, projectId: pr.id, nom: pr.name, dna, fond, exclus: (r?.exclus as number[]) ?? [], rattachementId: r?.id ?? null });
        if (out.length >= 10) return out;
      }
    }
    return out;
  },
  async tendancesSemaineDuProfil(profilId: number, semaine: string) {
    return db.select({ id: profilTendances.id, cle: profilTendances.cle, plateforme: profilTendances.plateforme, typeMedia: profilTendances.typeMedia, structure: profilTendances.structure, lift: profilTendances.lift, pourquoi: profilTendances.pourquoi, commentAdapter: profilTendances.commentAdapter })
      .from(profilTendances).where(and(eq(profilTendances.profilId, profilId), eq(profilTendances.semaine, semaine), eq(profilTendances.ecarteParJeanne, false)));
  },
  async ecarteesDuProjet(projectId: number) {
    const rows = await db.select({ cle: profilTendances.cle, ecarteLe: tendancesProjet.ecarteLe }).from(tendancesProjet)
      .innerJoin(profilTendances, eq(profilTendances.id, tendancesProjet.tendanceId))
      .where(and(eq(tendancesProjet.projectId, projectId), eq(tendancesProjet.statut, "ecarte"), isNotNull(tendancesProjet.ecarteLe)));
    return rows.map((r) => ({ cle: r.cle, ecarteLe: r.ecarteLe as Date }));
  },
  async enregistrerTendancesProjet(rows: InsertTendanceProjet[]) {
    if (rows.length) await db.insert(tendancesProjet).values(rows).onConflictDoNothing();
  },
  async marquerTri(projectId: number, semaine: string) {
    await db.update(profilRattachements).set({ dernierTri: semaine }).where(eq(profilRattachements.projectId, projectId));
  },
  async tendancesDuProjet(userId: string, projectId: number) {
    return db.select({
      id: tendancesProjet.id, tendanceId: tendancesProjet.tendanceId, statut: tendancesProjet.statut, expireLe: tendancesProjet.expireLe, adaptation: tendancesProjet.adaptation, contentId: tendancesProjet.contentId,
      plateforme: profilTendances.plateforme, typeMedia: profilTendances.typeMedia, structure: profilTendances.structure, lift: profilTendances.lift,
      nbForts: profilTendances.nbForts, nbComptes: profilTendances.nbComptes, exemples: profilTendances.exemples, pourquoi: profilTendances.pourquoi,
      statutTendance: profilTendances.statut, semaine: profilTendances.semaine,
    }).from(tendancesProjet).innerJoin(profilTendances, eq(profilTendances.id, tendancesProjet.tendanceId))
      .where(and(eq(tendancesProjet.userId, userId), eq(tendancesProjet.projectId, projectId)))
      .orderBy(desc(tendancesProjet.createdAt), desc(profilTendances.lift)).limit(40);
  },
};
