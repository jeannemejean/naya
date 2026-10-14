// Requêtes Drizzle du module profils de veille. Toute la base du module passe par ici.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { profilComptes, profilPassages, profilPosts, profilAnalyses, profilTendances, profilsVeille, profilRattachements, profilEtiquettes, tendancesProjet, projects, brandDna, fondations, type InsertProfilPost, type InsertProfilTendance, type InsertTendanceProjet } from "@shared/schema";
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
  /** Actif ET au moins un projet actif rattaché (propose ou confirme) : un profil vide ne coûte rien. */
  async profilsCollectables() {
    return db.selectDistinct({ id: profilsVeille.id, nom: profilsVeille.nom, description: profilsVeille.description })
      .from(profilsVeille)
      .innerJoin(profilRattachements, eq(profilRattachements.profilId, profilsVeille.id))
      .innerJoin(projects, eq(projects.id, profilRattachements.projectId))
      .where(and(eq(profilsVeille.statut, "actif"), inArray(profilRattachements.statut, ["propose", "confirme"]), eq(projects.projectStatus, "active")));
  },
  /** Rattachements actifs dont le profil a des tendances terminées pour cette semaine et pas encore triés. */
  async rattachementsATrier(semaine: string) {
    return db.selectDistinct({ userId: profilRattachements.userId, projectId: profilRattachements.projectId, profilId: profilRattachements.profilId, dernierTri: profilRattachements.dernierTri })
      .from(profilRattachements)
      .innerJoin(profilAnalyses, and(eq(profilAnalyses.profilId, profilRattachements.profilId), eq(profilAnalyses.semaine, semaine), inArray(profilAnalyses.statut, ["termine", "rien"])))
      .innerJoin(projects, eq(projects.id, profilRattachements.projectId))
      .where(and(inArray(profilRattachements.statut, ["propose", "confirme"]), eq(projects.projectStatus, "active"),
        sql`coalesce(${profilRattachements.dernierTri}, '') <> ${semaine}`));
  },
  async purgerPosts(maintenant: Date): Promise<number> {
    const limite = new Date(maintenant.getTime() - REGLES.retentionPostsJours * 24 * 3600_000);
    const r = await db.delete(profilPosts).where(lt(profilPosts.releveLe, limite)).returning({ id: profilPosts.id });
    return r.length;
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
  async rattachementDuProjet(userId: string, projectId: number) {
    const [r] = await db.select({ id: profilRattachements.id, profilId: profilRattachements.profilId, statut: profilRattachements.statut, raison: profilRattachements.raison, nomProfil: profilsVeille.nom, descriptionProfil: profilsVeille.description, statutProfil: profilsVeille.statut })
      .from(profilRattachements).innerJoin(profilsVeille, eq(profilsVeille.id, profilRattachements.profilId))
      .where(and(eq(profilRattachements.userId, userId), eq(profilRattachements.projectId, projectId))).limit(1);
    return r;
  },
  async tendanceProjet(userId: string, id: number) {
    const [r] = await db.select({ id: tendancesProjet.id, userId: tendancesProjet.userId, projectId: tendancesProjet.projectId, tendanceId: tendancesProjet.tendanceId, statut: tendancesProjet.statut, adaptation: tendancesProjet.adaptation, contentId: tendancesProjet.contentId, plateforme: profilTendances.plateforme, typeMedia: profilTendances.typeMedia, structure: profilTendances.structure })
      .from(tendancesProjet).innerJoin(profilTendances, eq(profilTendances.id, tendancesProjet.tendanceId))
      .where(and(eq(tendancesProjet.id, id), eq(tendancesProjet.userId, userId))).limit(1);
    return r;
  },
  async majTendanceProjet(id: number, patch: Record<string, unknown>) {
    await db.update(tendancesProjet).set(patch as any).where(eq(tendancesProjet.id, id));
  },
  async choisirProfil(userId: string, projectId: number, profilId: number) {
    await db.insert(profilRattachements).values({ userId, projectId, profilId, confiance: 1, raison: "Choisi par l'utilisatrice.", statut: "confirme" })
      .onConflictDoUpdate({ target: profilRattachements.projectId, set: { profilId, statut: "confirme", raison: "Choisi par l'utilisatrice.", updatedAt: new Date() } });
  },
  async refuserRattachement(userId: string, projectId: number) {
    const [r] = await db.select().from(profilRattachements).where(and(eq(profilRattachements.userId, userId), eq(profilRattachements.projectId, projectId))).limit(1);
    if (!r) return;
    const exclus = Array.from(new Set([...(((r.exclus as number[]) ?? [])), r.profilId]));
    await db.update(profilRattachements).set({ statut: "refuse", exclus, updatedAt: new Date() }).where(eq(profilRattachements.id, r.id));
  },
  async ajouterCompte(row: { profilId: number; plateforme: string; compte: string; url: string; origine: string; suggerePar?: string | null; statut: string }) {
    const [c] = await db.insert(profilComptes).values(row).onConflictDoNothing().returning();
    return c ?? null;
  },
  async compte(id: number) {
    const [c] = await db.select({ id: profilComptes.id, profilId: profilComptes.profilId, plateforme: profilComptes.plateforme, statut: profilComptes.statut }).from(profilComptes).where(eq(profilComptes.id, id)).limit(1);
    return c;
  },
  async nbSuivis(profilId: number, plateforme: string): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(profilComptes).where(and(eq(profilComptes.profilId, profilId), eq(profilComptes.plateforme, plateforme), eq(profilComptes.statut, "suivi")));
    return r?.n ?? 0;
  },
  async profil(id: number) {
    const [p] = await db.select().from(profilsVeille).where(eq(profilsVeille.id, id)).limit(1);
    return p;
  },
  async listeAdmin(mois: string) {
    const profils = await db.select().from(profilsVeille).orderBy(profilsVeille.statut, profilsVeille.nom);
    const out = [];
    for (const p of profils) {
      const [comptes, rattachements, passages] = await Promise.all([
        db.select().from(profilComptes).where(eq(profilComptes.profilId, p.id)).orderBy(profilComptes.plateforme, profilComptes.id),
        db.select({ id: profilRattachements.id, statut: profilRattachements.statut }).from(profilRattachements).where(eq(profilRattachements.profilId, p.id)),
        db.select().from(profilPassages).where(eq(profilPassages.profilId, p.id)).orderBy(desc(profilPassages.createdAt)).limit(6),
      ]);
      out.push({ ...p, comptes, nbProjets: rattachements.filter((r) => r.statut === "propose" || r.statut === "confirme").length, nbEnAttente: rattachements.filter((r) => r.statut === "en_attente").length, depenseMois: await this.depenseDuMois(p.id, mois), passages });
    }
    return out;
  },
  async creerProfil(row: { nom: string; description: string; criteres: unknown }) {
    const [p] = await db.insert(profilsVeille).values({ ...row, criteres: row.criteres as any, origine: "jeanne", statut: "actif" }).returning();
    return p;
  },
  async majProfil(id: number, patch: Record<string, unknown>) {
    const [p] = await db.update(profilsVeille).set({ ...patch, updatedAt: new Date() } as any).where(eq(profilsVeille.id, id)).returning();
    if (p && patch.statut === "actif") {
      // Un profil proposé validé : les projets en attente de lui deviennent rattachés.
      await db.update(profilRattachements).set({ statut: "propose", updatedAt: new Date() }).where(and(eq(profilRattachements.profilId, id), eq(profilRattachements.statut, "en_attente")));
    }
    return p;
  },
  async majCompteAdmin(id: number, patch: { statut: string }) {
    const [c] = await db.update(profilComptes).set({ ...patch, ...(patch.statut === "suivi" ? { echecsConsecutifs: 0 } : {}) }).where(eq(profilComptes.id, id)).returning();
    return c;
  },
  async tendancesAdmin(profilId: number, semaine: string) {
    return db.select().from(profilTendances).where(and(eq(profilTendances.profilId, profilId), eq(profilTendances.semaine, semaine))).orderBy(desc(profilTendances.lift));
  },
  async majTendanceAdmin(id: number, ecarteParJeanne: boolean) {
    const [t] = await db.update(profilTendances).set({ ecarteParJeanne }).where(eq(profilTendances.id, id)).returning();
    return t;
  },
  /** 40 posts récents, avec légende, pas encore étiquetés (banc d'évaluation). */
  async aEtiqueter() {
    return db.select({ id: profilPosts.id, typeMedia: profilPosts.typeMedia, legende: profilPosts.legende, url: profilPosts.url })
      .from(profilPosts).leftJoin(profilEtiquettes, eq(profilEtiquettes.postId, profilPosts.id))
      .where(and(isNull(profilEtiquettes.id), isNotNull(profilPosts.legende))).orderBy(desc(profilPosts.publieLe)).limit(40);
  },
  async etiqueter(postId: number, structure: string, accroche: string) {
    await db.insert(profilEtiquettes).values({ postId, structure, accroche }).onConflictDoUpdate({ target: profilEtiquettes.postId, set: { structure, accroche } });
  },
  async postsEtiquetes() {
    return db.select({ id: profilPosts.id, typeMedia: profilPosts.typeMedia, legende: profilPosts.legende, structure: profilEtiquettes.structure, accroche: profilEtiquettes.accroche })
      .from(profilEtiquettes).innerJoin(profilPosts, eq(profilPosts.id, profilEtiquettes.postId)) as any;
  },
};
