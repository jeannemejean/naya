// Chantiers sans mouvement (spec, points 2 et 5). Un « chantier », c'est une étape active, sinon
// un objectif actif sans étape en cours, sinon un projet actif sans objectif. S'il n'a eu aucun
// mouvement depuis 15 jours, Naya le signale le matin avec son prochain pas.
//
// Un mouvement : une tâche faite, une tâche créée par Jeanne (`source: manual`, hors rituels), un
// contenu publié, un prospect contacté, une réponse reçue, ou un rendez-vous de l'agenda dont le
// titre cite le chantier (nom du projet, de ses clients, de ses prospects actifs). L'agenda est
// LU, jamais écrit : aucune tâche n'est créée depuis l'agenda. Sans agenda relié (ou s'il ne
// répond pas), on continue sans cette source.
//
// Rattachement d'un mouvement : par étape, objectif et projet. Un champ ne départage que s'il est
// connu des deux côtés : une tâche d'une AUTRE étape ne compte pas, mais un mouvement qui ne
// connaît que son projet (contenu, prospect, réponse) compte pour tous les chantiers du projet —
// mieux vaut un chantier signalé trop tard qu'un signal à tort.
//
// Les jours sans mouvement sont comptés depuis le plus récent de : le dernier mouvement, le début
// du chantier (étape : la plus tardive de sa création et de son activation ; objectif, projet :
// leur création) et le début de l'observation (fenêtre de lecture, mise en route du fil). Un
// chantier né il y a moins de 15 jours n'a donc jamais de signal : il n'a pas encore pu bouger.
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  clients, content, inboxConversations, inboxMessages, leads, outreachMessages, projects, tasks,
} from "@shared/schema";
import { getCalendarEvents } from "../google-calendar";
import { etapesActives, type CarteFil } from "./carte";

export const SEUIL_JOURS = 15;
/** Fenêtre de lecture des mouvements : au-delà, le compteur affiche « au moins 60 jours ». */
export const FENETRE_JOURS = 60;
const JOUR_MS = 24 * 3600_000;

export type Chantier = {
  cle: string; libelle: string; projetId: number; objectifId?: number; etapeId?: number;
  noms: string[]; // projet, clients, prospects liés
  prochainPas: string;
  debut?: Date | null;
};

export interface ProjetActif { id: number; name: string; clientName?: string | null; createdAt?: Date | null }
export interface ClientLie { parentProjectId: number; name: string }
export interface LeadActif { projectId: number | null; name: string; company?: string | null }
export interface TacheOuverte {
  id: number; title: string; milestoneId: number | null; goalId: number | null; projectId: number | null; scheduledDate: string | null;
}

// ── Noms et agenda ─────────────────────────────────────────────────────────────────────

/** Sans accents ni casse, ponctuation remplacée par des espaces : « L'Épicerie » → « l epicerie ». */
function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Le titre cite-t-il un des noms, sur des mots entiers ? Les noms de moins de 3 lettres sont ignorés. */
export function evenementCite(titre: string, noms: string[]): boolean {
  const t = ` ${normaliser(titre)} `;
  return noms.some((n) => {
    const nom = normaliser(n);
    return nom.replace(/ /g, "").length >= 3 && t.includes(` ${nom} `);
  });
}

// ── Les chantiers ──────────────────────────────────────────────────────────────────────

const parDate = (a: TacheOuverte, b: TacheOuverte) =>
  (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999") || a.id - b.id;

/**
 * Les chantiers des projets actifs : chaque étape active (une par chaîne), sinon chaque objectif
 * actif sans étape en cours, sinon le projet s'il n'a aucun objectif actif. Le prochain pas est la
 * prochaine tâche non faite du chantier (par date prévue), sinon son titre.
 */
export function chantiersDe(
  carte: CarteFil, projetsActifs: ProjetActif[], clientsLies: ClientLie[], leadsActifs: LeadActif[],
  tachesOuvertes: TacheOuverte[] = [],
): Chantier[] {
  const ouvertes = [...tachesOuvertes].sort(parDate);
  const res: Chantier[] = [];
  for (const p of projetsActifs) {
    const noms = [
      p.name, p.clientName ?? "",
      ...clientsLies.filter((c) => c.parentProjectId === p.id).map((c) => c.name),
      ...leadsActifs.filter((l) => l.projectId === p.id).flatMap((l) => [l.name, l.company ?? ""]),
    ].map((n) => n.trim()).filter((n, i, t) => n && t.indexOf(n) === i);

    const objectifs = carte.objectifs.filter((o) => o.projetId === p.id);
    for (const o of objectifs) {
      const etapes = etapesActives(o.etapes);
      for (const e of etapes) {
        res.push({
          cle: `etape:${e.id}`, libelle: `${e.titre} (${p.name})`, projetId: p.id, objectifId: o.id, etapeId: e.id, noms,
          prochainPas: ouvertes.find((t) => t.milestoneId === e.id)?.title ?? e.titre, debut: e.debut ?? null,
        });
      }
      if (etapes.length === 0) {
        res.push({
          cle: `objectif:${o.id}`, libelle: `${o.titre} (${p.name})`, projetId: p.id, objectifId: o.id, noms,
          prochainPas: ouvertes.find((t) => t.goalId === o.id)?.title ?? o.titre, debut: o.creeLe ?? null,
        });
      }
    }
    const chaine = etapesActives(carte.chainesSansObjectif.get(p.id) ?? []);
    for (const e of chaine) {
      res.push({
        cle: `etape:${e.id}`, libelle: `${e.titre} (${p.name})`, projetId: p.id, etapeId: e.id, noms,
        prochainPas: ouvertes.find((t) => t.milestoneId === e.id)?.title ?? e.titre, debut: e.debut ?? null,
      });
    }
    if (objectifs.length === 0 && chaine.length === 0) {
      res.push({
        cle: `projet:${p.id}`, libelle: p.name, projetId: p.id, noms,
        prochainPas: ouvertes.find((t) => t.projectId === p.id)?.title ?? p.name, debut: p.createdAt ?? null,
      });
    }
  }
  return res;
}

// ── Le compteur ────────────────────────────────────────────────────────────────────────

/**
 * Les chantiers sans mouvement depuis `seuilJours` jours (au moins), du plus endormi au moins
 * endormi. `observeDepuis` : début de l'observation (fenêtre de lecture des mouvements) ; les
 * mouvements futurs (rendez-vous à venir) sont ignorés.
 */
export function chantiersSansMouvement(
  chantiers: Chantier[], mouvements: { cle: string; at: Date }[], maintenant: Date,
  seuilJours = SEUIL_JOURS, observeDepuis?: Date | null,
): { libelle: string; joursSansMouvement: number; prochainPas: string }[] {
  const dernier = new Map<string, number>();
  for (const m of mouvements) {
    const t = m.at.getTime();
    if (t > maintenant.getTime()) continue;
    if (t > (dernier.get(m.cle) ?? -Infinity)) dernier.set(m.cle, t);
  }
  const res: { libelle: string; joursSansMouvement: number; prochainPas: string }[] = [];
  for (const c of chantiers) {
    const reference = Math.max(dernier.get(c.cle) ?? -Infinity, c.debut?.getTime() ?? -Infinity, observeDepuis?.getTime() ?? -Infinity);
    if (reference === -Infinity) continue; // rien pour compter : pas de signal inventé
    const jours = Math.floor((maintenant.getTime() - reference) / JOUR_MS);
    if (jours >= seuilJours) res.push({ libelle: c.libelle, joursSansMouvement: jours, prochainPas: c.prochainPas });
  }
  return res.sort((a, b) => b.joursSansMouvement - a.joursSansMouvement);
}

// ── Les mouvements ─────────────────────────────────────────────────────────────────────

export interface MouvementBrut { projetId?: number | null; objectifId?: number | null; etapeId?: number | null; at: Date }

/** Les sources, toutes limitées à l'utilisatrice et à la période. Une requête par source. */
export interface SourcesMouvements {
  tachesFaites(userId: string, depuis: Date): Promise<MouvementBrut[]>;
  tachesCreees(userId: string, depuis: Date): Promise<MouvementBrut[]>;
  contenusPublies(userId: string, depuis: Date): Promise<MouvementBrut[]>;
  prospectsContactes(userId: string, depuis: Date): Promise<MouvementBrut[]>;
  reponsesRecues(userId: string, depuis: Date): Promise<MouvementBrut[]>;
  /** Rendez-vous de l'agenda (lecture seule). */
  agenda(userId: string, depuis: Date): Promise<{ titre: string; at: Date }[]>;
}

const differe = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && a !== b;

function rattache(m: MouvementBrut, c: Chantier): boolean {
  if (m.projetId == null && m.objectifId == null && m.etapeId == null) return false;
  if (differe(m.projetId, c.projetId) || differe(m.objectifId, c.objectifId) || differe(m.etapeId, c.etapeId)) return false;
  // Sans projet connu, il faut au moins l'objectif ou l'étape en commun.
  if (m.projetId == null) return (m.etapeId != null && m.etapeId === c.etapeId) || (m.objectifId != null && m.objectifId === c.objectifId);
  return true;
}

export async function collecterMouvements(
  userId: string, chantiers: Chantier[], depuis: Date, sources: SourcesMouvements = sourcesParDefaut,
): Promise<{ cle: string; at: Date }[]> {
  const lire = <T>(nom: string, p: () => Promise<T[]>) => p().catch((e: any) => {
    console.error(`[fil] mouvements (${nom}) :`, e?.message ?? e);
    return [] as T[];
  });
  const [faites, creees, publies, contactes, reponses, agenda] = await Promise.all([
    lire("tâches faites", () => sources.tachesFaites(userId, depuis)),
    lire("tâches créées", () => sources.tachesCreees(userId, depuis)),
    lire("contenus publiés", () => sources.contenusPublies(userId, depuis)),
    lire("prospects contactés", () => sources.prospectsContactes(userId, depuis)),
    lire("réponses reçues", () => sources.reponsesRecues(userId, depuis)),
    lire("agenda", () => sources.agenda(userId, depuis)),
  ]);
  const res: { cle: string; at: Date }[] = [];
  for (const m of [...faites, ...creees, ...publies, ...contactes, ...reponses]) {
    for (const c of chantiers) if (rattache(m, c)) res.push({ cle: c.cle, at: m.at });
  }
  for (const ev of agenda) {
    for (const c of chantiers) if (evenementCite(ev.titre, c.noms)) res.push({ cle: c.cle, at: ev.at });
  }
  return res;
}

// ── Sources par défaut (base, agenda) ──────────────────────────────────────────────────

const jourIso = (d: Date) => d.toISOString().slice(0, 10);
const brut = (r: { projetId: number | null; objectifId?: number | null; etapeId?: number | null; at: Date | null }): MouvementBrut[] =>
  r.at ? [{ projetId: r.projetId, objectifId: r.objectifId ?? null, etapeId: r.etapeId ?? null, at: r.at }] : [];

export const sourcesParDefaut: SourcesMouvements = {
  async tachesFaites(userId, depuis) {
    const rows = await db.select({ projetId: tasks.projectId, objectifId: tasks.goalId, etapeId: tasks.milestoneId, at: tasks.completedAt })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.completed, true), gte(tasks.completedAt, depuis)));
    return rows.flatMap(brut);
  },
  async tachesCreees(userId, depuis) {
    // Créée par Jeanne : `source = manual`. Les rituels et les marqueurs de jalon, posés par Naya, n'en sont pas.
    const rows = await db.select({ projetId: tasks.projectId, objectifId: tasks.goalId, etapeId: tasks.milestoneId, at: tasks.createdAt })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.source, "manual"), gte(tasks.createdAt, depuis),
        isNull(tasks.ritualId), ne(tasks.type, "milestone")));
    return rows.flatMap(brut);
  },
  async contenusPublies(userId, depuis) {
    const rows = await db.select({ projetId: content.projectId, at: content.publishedAt })
      .from(content)
      .where(and(eq(content.userId, userId), gte(content.publishedAt, depuis)));
    return rows.flatMap(brut);
  },
  async prospectsContactes(userId, depuis) {
    const rows = await db.select({ projetId: sql<number | null>`coalesce(${outreachMessages.projectId}, ${leads.projectId})`, at: outreachMessages.sentAt })
      .from(outreachMessages)
      .innerJoin(leads, eq(leads.id, outreachMessages.leadId))
      .where(and(eq(outreachMessages.userId, userId), gte(outreachMessages.sentAt, depuis)));
    return rows.flatMap(brut);
  },
  async reponsesRecues(userId, depuis) {
    const rows = await db.select({ projetId: sql<number | null>`coalesce(${inboxConversations.projectId}, ${leads.projectId})`, at: inboxMessages.sentAt })
      .from(inboxMessages)
      .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
      .innerJoin(leads, eq(leads.id, inboxConversations.leadId))
      .where(and(eq(inboxConversations.userId, userId), eq(inboxMessages.sens, "entrant"), eq(inboxMessages.nature, "reponse"),
        gte(inboxMessages.sentAt, depuis)));
    return rows.flatMap(brut);
  },
  async agenda(userId, depuis) {
    // getCalendarEvents rend [] sans agenda relié ou en cas d'erreur : jamais de panne du matin.
    const evenements = await getCalendarEvents(userId, jourIso(depuis), jourIso(new Date()));
    return evenements.map((e) => ({ titre: e.title, at: new Date(`${e.date}T${e.allDay ? "12:00" : e.startTime}:00`) }));
  },
};

// ── Le matin ───────────────────────────────────────────────────────────────────────────

/** Les chantiers sans mouvement, pour le matin. Rien tant que le fil n'est pas en route. */
export async function chargerChantiersBloques(
  userId: string, carte: CarteFil, maintenant: Date,
): Promise<{ libelle: string; joursSansMouvement: number; prochainPas: string }[]> {
  if (!carte.depuis) return [];
  const fenetre = new Date(maintenant.getTime() - FENETRE_JOURS * JOUR_MS);

  const projetsActifs = await db.select({ id: projects.id, name: projects.name, clientName: projects.clientName, createdAt: projects.createdAt })
    .from(projects)
    .where(and(eq(projects.userId, userId), or(eq(projects.projectStatus, "active"), isNull(projects.projectStatus))));
  if (projetsActifs.length === 0) return [];
  const ids = projetsActifs.map((p) => p.id);

  const [clientsLies, leadsActifs, ouvertes] = await Promise.all([
    db.select({ parentProjectId: clients.parentProjectId, name: clients.name }).from(clients)
      .where(and(eq(clients.userId, userId), inArray(clients.parentProjectId, ids), or(eq(clients.isActive, true), isNull(clients.isActive)))),
    db.select({ projectId: leads.projectId, name: leads.name, company: leads.company }).from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.projectId, ids), isNull(leads.archivedAt),
        or(isNull(leads.stage), ne(leads.stage, "no_follow")))),
    db.select({ id: tasks.id, title: tasks.title, milestoneId: tasks.milestoneId, goalId: tasks.goalId, projectId: tasks.projectId, scheduledDate: tasks.scheduledDate })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.completed, false), isNull(tasks.archivedAt), isNull(tasks.ritualId),
        ne(tasks.type, "milestone"), isNotNull(tasks.projectId), inArray(tasks.projectId, ids))),
  ]);

  const chantiers = chantiersDe(carte, projetsActifs, clientsLies, leadsActifs, ouvertes);
  if (chantiers.length === 0) return [];
  const mouvements = await collecterMouvements(userId, chantiers, fenetre);
  const observeDepuis = carte.depuis.getTime() > fenetre.getTime() ? carte.depuis : fenetre;
  return chantiersSansMouvement(chantiers, mouvements, maintenant, SEUIL_JOURS, observeDepuis);
}
