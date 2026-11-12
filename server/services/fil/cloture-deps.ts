// Les vraies sources de la clôture du vendredi et de la réconciliation du lundi (base, tâches).
// Séparées de cloture.ts pour que ses tests n'importent pas la base.
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { appelsOffres, inboxConversations, inboxMessages, leads, mailsEnAttente, tasks } from "@shared/schema";
import { TYPE_ATELIER, TYPE_VALIDATION } from "@shared/atelier";
import { creerTache } from "../taches/ecrire-tache";
import { depsCreation } from "./creation-deps";
import { SOURCE_CLOTURE, type DepsCloture, type DepsReconciliation } from "./cloture";

export const depsCloture: DepsCloture = {
  async tachesOuvertes(userId, creeesAvant, aujourdhui) {
    return db.select().from(tasks).where(and(
      eq(tasks.userId, userId), eq(tasks.completed, false), isNull(tasks.archivedAt), lt(tasks.createdAt, creeesAvant),
      // Une tâche déjà placée plus tard n'est pas à trancher.
      or(isNull(tasks.scheduledDate), lte(tasks.scheduledDate, aujourdhui)),
    ));
  },
  async clotureDejaPosee(userId, semaine) {
    // Toute tâche de clôture de la semaine, faite ou archivée comprise.
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(
      eq(tasks.userId, userId), eq(tasks.source, SOURCE_CLOTURE),
      sql`${tasks.actionData} -> 'cloture' ->> 'semaine' = ${semaine}`,
    )).limit(1);
    return !!t;
  },
  creerTache: (userId, donnees) => creerTache(userId, donnees),
};

export const depsReconciliation: DepsReconciliation = {
  async conversationsATraiter(userId) {
    // Le sens du dernier message (le plus récent, puis le plus grand id).
    const dernierSens = sql<string | null>`(select ${inboxMessages.sens} from ${inboxMessages}
      where ${inboxMessages.conversationId} = ${inboxConversations.id}
      order by ${inboxMessages.sentAt} desc, ${inboxMessages.id} desc limit 1)`;
    const lignes = await db.select({
      id: inboxConversations.id, canal: inboxConversations.channel, taskId: inboxConversations.taskId,
      nom: leads.name, tacheId: tasks.id, completed: tasks.completed, archivedAt: tasks.archivedAt, dernierSens,
    }).from(inboxConversations)
      .innerJoin(leads, eq(leads.id, inboxConversations.leadId))
      .leftJoin(tasks, and(eq(tasks.id, inboxConversations.taskId), eq(tasks.userId, userId)))
      .where(and(
        eq(inboxConversations.userId, userId), eq(inboxConversations.statut, "a_traiter"),
        // Un prospect supprimé (archivé) n'a plus rien à traiter.
        isNull(leads.archivedAt),
      ))
      .orderBy(desc(inboxConversations.lastMessageAt), desc(inboxConversations.id));
    return lignes.map((l) => ({
      id: l.id, nom: l.nom, canal: l.canal, taskId: l.taskId, dernierSens: l.dernierSens ?? null,
      tache: l.tacheId != null ? { completed: !!l.completed, archivedAt: l.archivedAt ?? null } : null,
    }));
  },
  async appelsOffres(userId) {
    return db.select({
      id: appelsOffres.id, objet: appelsOffres.objet, acheteur: appelsOffres.acheteur, scoreAdequation: appelsOffres.scoreAdequation,
      statut: appelsOffres.statut, dateLimite: appelsOffres.dateLimite, bloquants: appelsOffres.bloquants, source: appelsOffres.source,
    }).from(appelsOffres).where(and(
      eq(appelsOffres.userId, userId), eq(appelsOffres.scoreAdequation, "fort"),
      inArray(appelsOffres.statut, ["repere", "premier_jet_pret"]),
    ));
  },
  posts: (userId, debut, fin) => depsCreation.posts(userId, debut, fin),
  async tachesDeProduction(userId, semaines, postIds) {
    const conditions = [
      ...(semaines.length ? [and(inArray(tasks.taskType, [TYPE_ATELIER, TYPE_VALIDATION]), inArray(sql<string>`${tasks.actionData} ->> 'semaine'`, semaines))] : []),
      ...(postIds.length ? [inArray(tasks.contentId, postIds)] : []),
    ];
    if (conditions.length === 0) return [];
    const lignes = await db.select({
      taskType: tasks.taskType, semaine: sql<string | null>`${tasks.actionData} ->> 'semaine'`, contentId: tasks.contentId,
    }).from(tasks).where(and(
      eq(tasks.userId, userId), eq(tasks.completed, false), isNull(tasks.archivedAt), or(...conditions),
    ));
    return lignes.map((l) => ({
      semaine: l.taskType === TYPE_ATELIER || l.taskType === TYPE_VALIDATION ? l.semaine : null,
      contentId: l.contentId ?? null,
    }));
  },
  async mailsSansTache(userId, depuis) {
    // Une tâche cochée ou archivée existe encore : seules les lignes sans tâche en base remontent.
    return db.select({ threadId: mailsEnAttente.threadId, expediteur: mailsEnAttente.expediteur, sujet: mailsEnAttente.sujet })
      .from(mailsEnAttente)
      .leftJoin(tasks, eq(tasks.id, mailsEnAttente.taskId))
      .where(and(
        eq(mailsEnAttente.userId, userId), isNotNull(mailsEnAttente.taskId), isNull(tasks.id),
        sql`coalesce(${mailsEnAttente.dernierMessageAt}, ${mailsEnAttente.createdAt}) >= ${depuis.toISOString()}`,
      ))
      .orderBy(desc(mailsEnAttente.dernierMessageAt));
  },
};
