// Dépendances réelles de la vie perso : base (tables vie_perso_*, tâches), IA, agenda Google.
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  tasks, viePersoActivites, viePersoMembres, viePersoPlans, viePersoProfil, viePersoRecettes,
} from "@shared/schema";
import { PROFIL_DEFAUT, SOURCE_VIE_PERSO, type Fenetre, type ProfilViePerso } from "@shared/vie-perso";
import { storage } from "../../storage";
import { CLAUDE_MODELS } from "../claude";
import { genererStructure } from "../ai/structure";
import { getCalendarEvents } from "../google-calendar";
import { enMin, enHeure, type Occupes } from "./placement";
import type { DepsViePerso, OrigineTache } from "./service";

/** Variable VIE_PERSO_USERS (ids séparés par des virgules). Vide ou absente : personne. */
export function viePersoActivePour(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VIE_PERSO_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

export async function lireProfil(userId: string): Promise<ProfilViePerso> {
  const [l] = await db.select().from(viePersoProfil).where(eq(viePersoProfil.userId, userId));
  return { ...PROFIL_DEFAUT, ...(l?.reglages ?? {}) };
}

export async function ecrireProfil(userId: string, reglages: ProfilViePerso): Promise<void> {
  await db.insert(viePersoProfil).values({ userId, reglages })
    .onConflictDoUpdate({ target: viePersoProfil.userId, set: { reglages, updatedAt: new Date() } });
}

const memeOrigine = (o: OrigineTache) => sql`${tasks.actionData} -> 'vieperso' -> 'origine' = ${JSON.stringify(o)}::jsonb`;

export const depsViePerso: DepsViePerso = {
  profil: lireProfil,
  async membres(userId) {
    return db.select().from(viePersoMembres).where(eq(viePersoMembres.userId, userId)).orderBy(asc(viePersoMembres.id));
  },
  async recettes(userId) {
    return db.select().from(viePersoRecettes).where(eq(viePersoRecettes.userId, userId)).orderBy(asc(viePersoRecettes.id));
  },
  async lirePlan(userId, semaine) {
    const [l] = await db.select().from(viePersoPlans).where(and(eq(viePersoPlans.userId, userId), eq(viePersoPlans.semaine, semaine)));
    return l ? { statut: l.statut as "brouillon" | "valide", contenu: l.contenu, coches: l.coches ?? [] } : null;
  },
  async ecrirePlan(userId, semaine, contenu, o) {
    const base = { contenu, statut: o.statut, updatedAt: new Date(), ...(o.coutEur != null ? { coutEur: o.coutEur.toFixed(4) } : {}) };
    const set = o.garderCoches ? base : { ...base, coches: [] as number[] };
    await db.insert(viePersoPlans).values({ userId, semaine, ...set, coches: [] })
      .onConflictDoUpdate({ target: [viePersoPlans.userId, viePersoPlans.semaine], set });
  },
  async lireActivite(userId, id) {
    const [a] = await db.select().from(viePersoActivites).where(and(eq(viePersoActivites.id, id), eq(viePersoActivites.userId, userId)));
    return a ? { ...a, quand: a.quand as Fenetre, contenu: a.contenu ?? null } : null;
  },
  async ecrireActivite(userId, id, modif) {
    await db.update(viePersoActivites).set({ ...modif, updatedAt: new Date() })
      .where(and(eq(viePersoActivites.id, id), eq(viePersoActivites.userId, userId)));
  },
  async clesFaites(userId, origine) {
    const r = await db.select({ a: tasks.actionData }).from(tasks).where(and(
      eq(tasks.userId, userId), eq(tasks.source, SOURCE_VIE_PERSO), eq(tasks.completed, true), memeOrigine(origine),
    ));
    return new Set(r.map((x) => (x.a as any)?.vieperso?.cle).filter((c): c is string => typeof c === "string"));
  },
  async supprimerTachesNonFaites(userId, origine) {
    // Une transaction, et les références d'abord (notes déposées, messages du compagnon…) :
    // sans elles, la suppression échouerait sur une clé étrangère dès qu'on a ouvert la tâche.
    return db.transaction(async (tx) => {
      const ids = (await tx.select({ id: tasks.id }).from(tasks).where(and(
        eq(tasks.userId, userId), eq(tasks.source, SOURCE_VIE_PERSO), eq(tasks.completed, false), memeOrigine(origine),
      ))).map((t) => t.id);
      if (ids.length === 0) return 0;
      await storage.clearTaskReferences(tx as any, ids);
      await tx.delete(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
      return ids.length;
    });
  },
  async occupes(userId, de, a) {
    const occ: Occupes = new Map();
    const ajouter = (jour: string, start: number, end: number) => {
      if (end <= start) return;
      if (!occ.has(jour)) occ.set(jour, []);
      occ.get(jour)!.push({ start, end });
    };
    const lignes = await db.select({
      d: tasks.scheduledDate, h: tasks.scheduledTime, duree: tasks.estimatedDuration,
    }).from(tasks).where(and(eq(tasks.userId, userId), isNull(tasks.archivedAt), gte(tasks.scheduledDate, de), lte(tasks.scheduledDate, a)));
    for (const l of lignes) {
      if (!l.d || !l.h || !/^\d{2}:\d{2}$/.test(l.h)) continue;
      ajouter(l.d, enMin(l.h), enMin(l.h) + (l.duree || 30));
    }
    // Agenda Google : ne fait jamais échouer le placement.
    const evts = await getCalendarEvents(userId, de, a).catch(() => []);
    for (const e of evts) if (!e.allDay && e.startTime !== e.endTime) ajouter(e.date, enMin(e.startTime), enMin(e.endTime));
    return occ;
  },
  async creerTaches(userId, origine, taches) {
    for (const t of taches) {
      await storage.createTask({
        userId, title: t.titre, description: t.description || null,
        type: "admin", category: "planning", priority: 2,
        source: SOURCE_VIE_PERSO, schedulingMode: "fixed", projectId: null,
        scheduledDate: t.jour, scheduledTime: t.heure, scheduledEndTime: enHeure(Math.min(enMin(t.heure) + t.duree, 23 * 60 + 59)),
        estimatedDuration: t.duree,
        actionData: { vieperso: { origine, cle: t.cle } },
      } as any);
    }
    return taches.length;
  },
  generer: (o) => genererStructure({
    schema: o.schema, system: o.system, prompt: o.prompt, maxTokens: o.maxTokens,
    model: o.rapide ? CLAUDE_MODELS.fast : CLAUDE_MODELS.smart,
    taskKind: o.rapide ? "fast_generation" : "strategic_reasoning",
    etape: o.etape, userId: o.userId,
  }),
  maintenant() {
    const now = new Date();
    const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
    return { jour, min: h * 60 + (m || 0) };
  },
};

// ─── Écritures simples des écrans (foyer, inspirations, activités, coches) ─────────────────

export const storeViePerso = {
  ecrireProfil,
  async ajouterMembre(userId: string, m: Omit<typeof viePersoMembres.$inferInsert, "id" | "userId" | "createdAt">) {
    const [l] = await db.insert(viePersoMembres).values({ ...m, userId }).returning();
    return l;
  },
  async modifierMembre(userId: string, id: number, m: Partial<typeof viePersoMembres.$inferInsert>) {
    const [l] = await db.update(viePersoMembres).set(m).where(and(eq(viePersoMembres.id, id), eq(viePersoMembres.userId, userId))).returning();
    return l;
  },
  async supprimerMembre(userId: string, id: number) {
    const r = await db.delete(viePersoMembres).where(and(eq(viePersoMembres.id, id), eq(viePersoMembres.userId, userId))).returning({ id: viePersoMembres.id });
    return r.length > 0;
  },
  async ajouterRecette(userId: string, r: Omit<typeof viePersoRecettes.$inferInsert, "id" | "userId" | "createdAt">) {
    const [l] = await db.insert(viePersoRecettes).values({ ...r, userId }).returning();
    return l;
  },
  async modifierRecette(userId: string, id: number, r: Partial<typeof viePersoRecettes.$inferInsert>) {
    const [l] = await db.update(viePersoRecettes).set(r).where(and(eq(viePersoRecettes.id, id), eq(viePersoRecettes.userId, userId))).returning();
    return l;
  },
  async supprimerRecette(userId: string, id: number) {
    const r = await db.delete(viePersoRecettes).where(and(eq(viePersoRecettes.id, id), eq(viePersoRecettes.userId, userId))).returning({ id: viePersoRecettes.id });
    return r.length > 0;
  },
  async listerActivites(userId: string) {
    return db.select().from(viePersoActivites).where(eq(viePersoActivites.userId, userId)).orderBy(asc(viePersoActivites.id));
  },
  async ajouterActivite(userId: string, a: Omit<typeof viePersoActivites.$inferInsert, "id" | "userId" | "createdAt" | "updatedAt">) {
    const [l] = await db.insert(viePersoActivites).values({ ...a, userId }).returning();
    return l;
  },
  async supprimerActivite(userId: string, id: number) {
    await depsViePerso.supprimerTachesNonFaites(userId, { activite: id });
    const r = await db.delete(viePersoActivites).where(and(eq(viePersoActivites.id, id), eq(viePersoActivites.userId, userId))).returning({ id: viePersoActivites.id });
    return r.length > 0;
  },
  /** Coche ou décoche UNE case en une seule requête (jamais lire puis réécrire le tableau). */
  async basculerCoche(userId: string, semaine: string, index: number, coche: boolean): Promise<number[] | null> {
    const sans = sql`coalesce((select jsonb_agg(e order by e) from jsonb_array_elements(${viePersoPlans.coches}) e where e <> to_jsonb(${index}::int)), '[]'::jsonb)`;
    const valeur = coche ? sql`(select jsonb_agg(e order by e) from jsonb_array_elements(${sans} || to_jsonb(${index}::int)) e)` : sans;
    const [r] = await db.update(viePersoPlans).set({ coches: valeur as any, updatedAt: new Date() })
      .where(and(eq(viePersoPlans.userId, userId), eq(viePersoPlans.semaine, semaine))).returning({ coches: viePersoPlans.coches });
    return r ? (r.coches as number[]).map(Number) : null;
  },
};
export type StoreViePerso = typeof storeViePerso;
