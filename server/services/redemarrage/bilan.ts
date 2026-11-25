// Bilan silencieux : ce que Naya sait déjà, projet par projet, AVANT de poser la moindre question.
// Chaque lecture est bornée à l'utilisatrice ; les filtres ci-dessous le revérifient.
import { and, desc, eq, gte, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { db } from "../../db";
import { content, envois, projects, recurringRituals, tasks } from "@shared/schema";
import { STATUTS_A_RELANCER } from "@shared/envois";
import { formatRythmeServeur } from "./format";

export interface BilanProjet {
  projectId: number; nom: string; statut: string; priorite: number | null;
  noteActuelle: string | null;
  tachesEnRetard: { id: number; titre: string; date: string }[];
  derniereTacheFaite: string | null;
  postsPrevus: number; postsPublies: number;
  creneaux: { id: number; titre: string; rythme: string }[];
  envoisEnCours: { id: number; marque: string; objet: string; prochaineRelance: string | null }[];
}
export interface BilanSilencieux { depuis: string; projets: BilanProjet[] }

export interface DepsBilan {
  projets(userId: string): Promise<any[]>;
  tachesEnRetard(userId: string, aujourdhui: string): Promise<any[]>;
  derniereTacheFaite(userId: string, projectId: number): Promise<Date | null>;
  posts(userId: string, depuis: Date, maintenant: Date): Promise<any[]>;
  rituels(userId: string): Promise<any[]>;
  envois(userId: string): Promise<any[]>;
}

const RETARD_MAX = 30;
const jour = (d: Date) => d.toISOString().slice(0, 10);

export const depsBilan: DepsBilan = {
  projets: (userId) => db.select().from(projects).where(eq(projects.userId, userId)),
  tachesEnRetard: (userId, aujourdhui) => db.select().from(tasks).where(and(
    eq(tasks.userId, userId), eq(tasks.completed, false), isNull(tasks.archivedAt), lt(tasks.scheduledDate, aujourdhui),
  )).orderBy(tasks.scheduledDate),
  derniereTacheFaite: async (userId, projectId) => (await db.select({ t: tasks.completedAt }).from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.projectId, projectId), isNotNull(tasks.completedAt)))
    .orderBy(desc(tasks.completedAt)).limit(1))[0]?.t ?? null,
  posts: (userId, depuis, maintenant) => db.select().from(content).where(and(
    eq(content.userId, userId), isNull(content.supprimeLe), gte(content.scheduledFor, depuis), lte(content.scheduledFor, maintenant),
  )),
  rituels: (userId) => db.select().from(recurringRituals).where(and(eq(recurringRituals.userId, userId), eq(recurringRituals.active, true))),
  envois: (userId) => db.select().from(envois).where(eq(envois.userId, userId)),
};

const RANG_STATUT: Record<string, number> = { active: 0, paused: 1 };

export async function bilanSilencieux(deps: DepsBilan, userId: string, depuis: Date, maintenant: Date): Promise<BilanSilencieux> {
  const aujourdhui = jour(maintenant);
  const [projetsBruts, retards, posts, rituels, lesEnvois] = await Promise.all([
    deps.projets(userId), deps.tachesEnRetard(userId, aujourdhui), deps.posts(userId, depuis, maintenant),
    deps.rituels(userId), deps.envois(userId),
  ]);
  const a_elle = <T extends { userId?: string }>(l: T[]) => l.filter((x) => x.userId === userId);
  const retenus = a_elle(projetsBruts)
    .filter((p) => p.projectStatus in RANG_STATUT)
    .sort((a, b) => RANG_STATUT[a.projectStatus] - RANG_STATUT[b.projectStatus]
      || (a.priorityLevel ?? Infinity) - (b.priorityLevel ?? Infinity)
      || String(a.name).localeCompare(String(b.name), "fr"));

  const projets: BilanProjet[] = [];
  for (const p of retenus) {
    const derniere = await deps.derniereTacheFaite(userId, p.id);
    const sesPosts = a_elle(posts).filter((c) => c.projectId === p.id);
    projets.push({
      projectId: p.id, nom: p.name, statut: p.projectStatus, priorite: p.priorityLevel ?? null,
      noteActuelle: p.statusNote ?? null,
      tachesEnRetard: a_elle(retards).filter((t) => t.projectId === p.id).slice(0, RETARD_MAX)
        .map((t) => ({ id: t.id, titre: t.title, date: String(t.scheduledDate).slice(0, 10) })),
      derniereTacheFaite: derniere ? derniere.toISOString() : null,
      postsPrevus: sesPosts.length,
      postsPublies: sesPosts.filter((c) => c.postStatus === "posted" || !!c.publishedAt).length,
      creneaux: a_elle(rituels).filter((r) => r.projectId === p.id && r.active)
        .map((r) => ({ id: r.id, titre: r.title, rythme: formatRythmeServeur(r.days, r.intervalWeeks) })),
      envoisEnCours: a_elle(lesEnvois).filter((e) => e.projectId === p.id && STATUTS_A_RELANCER.has(e.statut))
        .map((e) => ({ id: e.id, marque: e.marque, objet: e.objet, prochaineRelance: e.prochaineRelance ?? null })),
    });
  }
  return { depuis: depuis.toISOString(), projets };
}
