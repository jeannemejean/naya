// Les vraies dépendances des indicateurs (base, agenda Google, API des réseaux). Séparées de
// indicateurs.ts pour que ses tests n'importent ni la base ni le réseau. Toute lecture porte le
// userId. Les jetons des comptes reliés ne sortent jamais d'ici (ni journal, ni message).
import { and, count, countDistinct, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  appelsOffres, content, inboxConversations, inboxMessages, indicateursReleves, leads, outreachMessages,
  projectGoals, projects, socialAccounts, tasks,
} from "@shared/schema";
import { storage } from "../../storage";
import { parisTodayString } from "../../utils/timezone";
import { lireEvenementsAgenda } from "../google-calendar";
import { AudienceIndisponible, lireAbonnes } from "../social-publishers";
import { SOURCE_TACHE_RELANCE } from "../reponses/relance-etat";
import {
  calculerIndicateurs, SourceIndisponible, type CompteRelie, type DepsReleve, type LigneReleve, type SourcesIndicateurs,
} from "./indicateurs";

/** Stades d'un prospect jamais contacté : ses noms ne désignent pas un rendez-vous. */
const NON_CONTACTES = ["identified", "messages_ready"];
const EN_DISCUSSION = ["in_discussion", "proposal_sent"];
/** Prospect qui a réellement échangé (même liste que `STADES_ENGAGES` de routes-reponses.ts). */
const STADES_ENGAGES = ["in_discussion", "proposal_sent", "signed"];
/** 4 semaines d'agenda tiennent largement en 8 pages de 250 ; au-delà, « indisponible ». */
const PAGES_AGENDA_MAX = 8;

const actif = isNull(leads.archivedAt);

/** Comptes dont on suit l'audience : Instagram, profil et pages LinkedIn, actifs. */
const estCompteSuivi = or(eq(socialAccounts.platform, "instagram"), eq(socialAccounts.platform, "linkedin"),
  sql`${socialAccounts.platform} like 'linkedin_page_%'`);

async function comptesRelies(userId: string): Promise<CompteRelie[]> {
  // Sans la colonne du jeton : rien à déchiffrer, rien qui puisse fuir.
  const rows = await db.select({ id: socialAccounts.id, plateforme: socialAccounts.platform, nom: socialAccounts.accountName })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.isActive, true), estCompteSuivi))
    .orderBy(socialAccounts.id);
  return rows;
}

export const sourcesIndicateurs: SourcesIndicateurs = {
  async prospection(userId, depuis) {
    const [[envois], reponses] = await Promise.all([
      db.select({ n: count() }).from(outreachMessages)
        .where(and(eq(outreachMessages.userId, userId), gte(outreachMessages.sentAt, depuis))),
      db.selectDistinct({ leadId: inboxConversations.leadId, stage: leads.stage })
        .from(inboxMessages)
        .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
        .innerJoin(leads, eq(leads.id, inboxConversations.leadId))
        .where(and(eq(inboxConversations.userId, userId), eq(inboxMessages.sens, "entrant"), eq(inboxMessages.nature, "reponse"),
          gte(inboxMessages.sentAt, depuis))),
    ]);
    return {
      envois: Number(envois?.n ?? 0),
      reponses: reponses.length,
      interesses: reponses.filter((r) => r.stage != null && STADES_ENGAGES.includes(r.stage)).length,
    };
  },
  async nomsProspects(userId) {
    const rows = await db.select({ name: leads.name, company: leads.company }).from(leads)
      .where(and(eq(leads.userId, userId), actif, isNotNull(leads.stage), notInArray(leads.stage, NON_CONTACTES)));
    return [...new Set(rows.flatMap((r) => [r.name, r.company ?? ""]).map((n) => n.trim()).filter(Boolean))];
  },
  async agenda(userId, debut, fin) {
    const evenements = await lireEvenementsAgenda(userId, parisTodayString(debut), parisTodayString(fin), PAGES_AGENDA_MAX)
      .catch(() => { throw new SourceIndisponible("agenda illisible"); });
    if (evenements == null) return null;
    return evenements.map((e) => ({ titre: e.title, at: new Date(`${e.date}T${e.allDay ? "12:00" : e.startTime}:00`) }));
  },
  async pipeline(userId, aujourdhui) {
    const [[discussion], [relances]] = await Promise.all([
      db.select({ n: count() }).from(leads)
        .where(and(eq(leads.userId, userId), actif, inArray(leads.stage, EN_DISCUSSION))),
      db.select({ n: count() }).from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.source, SOURCE_TACHE_RELANCE), eq(tasks.completed, false),
          isNull(tasks.archivedAt),
          // La date convenue (actionData.relance.date) : le report des tâches en retard déplace
          // `scheduledDate` au jour même, jamais cette date-là.
          sql`coalesce(${tasks.actionData}->'relance'->>'date', ${tasks.scheduledDate}) < ${aujourdhui}`)),
    ]);
    return { enDiscussion: Number(discussion?.n ?? 0), relancesEchues: Number(relances?.n ?? 0) };
  },
  async objectifs(userId) {
    return db.select({ projetId: projectGoals.projectId, goalType: projectGoals.goalType, successMode: projectGoals.successMode, cible: projectGoals.targetValue })
      .from(projectGoals)
      .innerJoin(projects, eq(projects.id, projectGoals.projectId))
      .where(and(eq(projects.userId, userId), eq(projectGoals.status, "active")));
  },
  async signes(userId, projetId) {
    const [r] = await db.select({ n: countDistinct(leads.id) }).from(leads)
      .where(and(eq(leads.userId, userId), actif, eq(leads.stage, "signed"),
        projetId != null ? or(eq(leads.projectId, projetId), isNull(leads.projectId)) : undefined));
    return Number(r?.n ?? 0);
  },
  comptes: comptesRelies,
  async abonnes(userId, compteId, maintenant) {
    const compte = (await storage.getSocialAccounts(userId)).find((c) => c.id === compteId);
    if (!compte) throw new SourceIndisponible("compte non relié");
    try {
      return await lireAbonnes({
        platform: compte.platform, accountId: compte.accountId, accessToken: compte.accessToken, expiresAt: compte.expiresAt,
      }, maintenant);
    } catch (e) {
      // Seules les raisons courtes de lireAbonnes sont montrées ; jamais un message brut.
      throw new SourceIndisponible(e instanceof AudienceIndisponible ? e.message : "lecture impossible");
    }
  },
  async postsPublies(userId, compteId, depuis) {
    const [r] = await db.select({ n: count() }).from(content)
      .where(and(eq(content.userId, userId), eq(content.socialAccountId, compteId), gte(content.publishedAt, depuis)));
    return Number(r?.n ?? 0);
  },
  async appelsOffres(userId) {
    return db.select({ statut: appelsOffres.statut, dateLimite: appelsOffres.dateLimite, bloquants: appelsOffres.bloquants, source: appelsOffres.source })
      .from(appelsOffres).where(eq(appelsOffres.userId, userId));
  },
};

// ── Le relevé ──────────────────────────────────────────────────────────────────────────

/**
 * Upsert du relevé du jour sur l'index unique (user_id, cle, releve_le). La garde `WHERE` est le
 * miroir de `fusionnerReleve` : une valeur disponible remplace tout, une indisponibilité ne
 * remplace qu'une indisponibilité (exportée pour les tests).
 */
export function requeteEcrireReleve(userId: string, jour: string, lignes: LigneReleve[]) {
  return db.insert(indicateursReleves)
    .values(lignes.map((l) => ({ userId, cle: l.cle, valeur: l.valeur, texte: l.texte, indisponible: l.indisponible, releveLe: jour })))
    .onConflictDoUpdate({
      target: [indicateursReleves.userId, indicateursReleves.cle, indicateursReleves.releveLe],
      set: {
        valeur: sql`excluded.valeur`, texte: sql`excluded.texte`, indisponible: sql`excluded.indisponible`,
      },
      setWhere: sql`excluded.indisponible is null or ${indicateursReleves.indisponible} is not null`,
    });
}

/** Par clé, le dernier relevé disponible strictement avant `jour` (exportée pour les tests). */
export function requetePrecedentes(userId: string, jour: string) {
  return db.selectDistinctOn([indicateursReleves.cle], {
    cle: indicateursReleves.cle, valeur: indicateursReleves.valeur, texte: indicateursReleves.texte, indisponible: indicateursReleves.indisponible,
  })
    .from(indicateursReleves)
    .where(and(eq(indicateursReleves.userId, userId), lt(indicateursReleves.releveLe, jour), isNull(indicateursReleves.indisponible)))
    .orderBy(indicateursReleves.cle, sql`${indicateursReleves.releveLe} desc`);
}

export const depsReleve: DepsReleve = {
  calculer: (userId, maintenant) => calculerIndicateurs(userId, maintenant, sourcesIndicateurs),
  async ecrire(userId, jour, lignes) {
    if (lignes.length === 0) return;
    await requeteEcrireReleve(userId, jour, lignes);
  },
  lireJour: (userId, jour) => db.select({
    cle: indicateursReleves.cle, valeur: indicateursReleves.valeur, texte: indicateursReleves.texte, indisponible: indicateursReleves.indisponible,
  }).from(indicateursReleves).where(and(eq(indicateursReleves.userId, userId), eq(indicateursReleves.releveLe, jour))),
  precedentes: (userId, jour) => requetePrecedentes(userId, jour),
  comptes: comptesRelies,
};
