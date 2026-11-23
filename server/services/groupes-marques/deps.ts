// Dépendances des groupes de marques (lot 9). Injectées : les tests de routes les simulent sans base.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { groupeMarquesProjets, groupesMarques, projects, type GroupeMarques } from "@shared/schema";
import { projetsDuGroupe, type GroupeSaisi } from "@shared/groupes-marques";

export type GroupeAvecProjets = GroupeMarques & { projectIds: number[] };

export interface DepsGroupesMarques {
  groupes(userId: string): Promise<GroupeAvecProjets[]>;
  /** Parmi ces ids, ceux des projets de l'utilisatrice. */
  projetsSiens(userId: string, ids: number[]): Promise<number[]>;
  creer(userId: string, g: GroupeSaisi): Promise<GroupeAvecProjets>;
  /** undefined : groupe inconnu ou d'un autre compte. */
  modifier(id: number, userId: string, patch: Partial<GroupeSaisi>): Promise<GroupeAvecProjets | undefined>;
  supprimer(id: number, userId: string): Promise<boolean>;
  /** Les projets (de l'utilisatrice) d'un groupe ; null s'il est introuvable pour elle. */
  projetsDuGroupe(userId: string, groupeId: number): Promise<number[] | null>;
}

async function avecProjets(lignes: GroupeMarques[], userId: string): Promise<GroupeAvecProjets[]> {
  if (lignes.length === 0) return [];
  const liens = await db.select({ groupeId: groupeMarquesProjets.groupeId, projectId: groupeMarquesProjets.projectId })
    .from(groupeMarquesProjets)
    .innerJoin(projects, eq(projects.id, groupeMarquesProjets.projectId))
    .where(and(inArray(groupeMarquesProjets.groupeId, lignes.map((g) => g.id)), eq(projects.userId, userId)));
  return lignes.map((g) => ({ ...g, projectIds: liens.filter((l) => l.groupeId === g.id).map((l) => l.projectId) }));
}

export const depsGroupesMarques: DepsGroupesMarques = {
  async groupes(userId) {
    const lignes = await db.select().from(groupesMarques).where(eq(groupesMarques.userId, userId)).orderBy(asc(groupesMarques.nom));
    return avecProjets(lignes, userId);
  },
  async projetsSiens(userId, ids) {
    if (ids.length === 0) return [];
    const r = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), inArray(projects.id, ids)));
    return r.map((x) => x.id);
  },
  async creer(userId, g) {
    return db.transaction(async (tx) => {
      const [ligne] = await tx.insert(groupesMarques).values({ userId, nom: g.nom, couleur: g.couleur }).returning();
      if (g.projectIds.length) await tx.insert(groupeMarquesProjets).values(g.projectIds.map((projectId) => ({ groupeId: ligne.id, projectId })));
      return { ...ligne, projectIds: g.projectIds };
    });
  },
  async modifier(id, userId, patch) {
    const ok = await db.transaction(async (tx) => {
      const [g] = await tx.select().from(groupesMarques).where(and(eq(groupesMarques.id, id), eq(groupesMarques.userId, userId)));
      if (!g) return false;
      const champs: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.nom !== undefined) champs.nom = patch.nom;
      if (patch.couleur !== undefined) champs.couleur = patch.couleur;
      await tx.update(groupesMarques).set(champs).where(and(eq(groupesMarques.id, id), eq(groupesMarques.userId, userId)));
      if (patch.projectIds !== undefined) {
        await tx.delete(groupeMarquesProjets).where(eq(groupeMarquesProjets.groupeId, id));
        if (patch.projectIds.length) await tx.insert(groupeMarquesProjets).values(patch.projectIds.map((projectId) => ({ groupeId: id, projectId })));
      }
      return true;
    });
    if (!ok) return undefined;
    const [g] = await db.select().from(groupesMarques).where(and(eq(groupesMarques.id, id), eq(groupesMarques.userId, userId)));
    return g ? (await avecProjets([g], userId))[0] : undefined;
  },
  async supprimer(id, userId) {
    const r = await db.delete(groupesMarques).where(and(eq(groupesMarques.id, id), eq(groupesMarques.userId, userId))).returning({ id: groupesMarques.id });
    return r.length > 0;
  },
  async projetsDuGroupe(userId, groupeId) {
    const [g] = await db.select({ id: groupesMarques.id, userId: groupesMarques.userId }).from(groupesMarques)
      .where(and(eq(groupesMarques.id, groupeId), eq(groupesMarques.userId, userId)));
    if (!g) return null;
    const liens = await db.select({ groupeId: groupeMarquesProjets.groupeId, projectId: groupeMarquesProjets.projectId, userId: projects.userId })
      .from(groupeMarquesProjets)
      .innerJoin(projects, eq(projects.id, groupeMarquesProjets.projectId))
      .where(eq(groupeMarquesProjets.groupeId, groupeId));
    return projetsDuGroupe(g, liens, liens.map((l) => ({ id: l.projectId, userId: l.userId })), userId);
  },
};
