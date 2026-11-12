// Les vraies dépendances des mails en attente (base, Unipile, tâches). Séparées de
// mails-attente.ts pour que ses tests n'importent ni la base ni le réseau.
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { clients, inboxConversations, leads, mailsEnAttente, projects, tasks } from "@shared/schema";
import { plusJours } from "@shared/atelier";
import { storage } from "../../storage";
import { listerEmailsRecus } from "../unipile-mail";
import { listUnipileAccounts } from "../linkedin";
import { joursTravailles } from "../campagne/placement";
import { creerTache } from "../taches/ecrire-tache";
import { rattacheurDuPassage } from "./rattachement";
import { RESERVATION_PERIMEE_MS, type DepsMails } from "./mails-attente";

const adresse = (v: unknown): string | null =>
  typeof v === "string" && v.includes("@") ? v.trim().toLowerCase() : null;

export const depsMails: DepsMails = {
  async compteEmail(userId) {
    // Le compte de l'utilisatrice (périmètre « marque ») ; les boîtes des projets clients ne sont pas les siennes.
    const prefs: any = await storage.getUserPreferences(userId);
    if (!prefs?.emailUnipileAccountId) return null;
    if (prefs.comptesDeconnectes?.email) return null;
    return prefs.emailUnipileAccountId;
  },
  listerEmails: (accountId, depuis) => listerEmailsRecus(accountId, depuis),
  async adressesPropres(userId, accountId) {
    const prefs: any = await storage.getUserPreferences(userId);
    const user: any = await storage.getUser(userId);
    const s = new Set<string>();
    for (const a of [user?.email, prefs?.prospectionSenderEmail]) { const x = adresse(a); if (x) s.add(x); }
    // L'adresse Google derrière le compte Unipile (lecture seule). Une panne ne bloque rien :
    // les mails envoyés (`role: sent`) restent reconnus comme les siens.
    try {
      const x = adresse((await listUnipileAccounts()).find((c) => c.id === accountId)?.adresse);
      if (x) s.add(x);
    } catch (e: any) {
      console.warn(`[fil] mails en attente : adresse du compte illisible user=${userId}:`, e?.message ?? e);
    }
    return s;
  },
  async adressesProspects(userId) {
    const rows = await db.select({ email: leads.email }).from(leads)
      .where(and(eq(leads.userId, userId), isNotNull(leads.email)));
    return new Set(rows.map((r) => adresse(r.email)).filter((x): x is string => !!x));
  },
  async threadsProspects(userId) {
    const rows = await db.select({ t: inboxConversations.providerChatId }).from(inboxConversations).where(and(
      eq(inboxConversations.userId, userId), eq(inboxConversations.channel, "email"), isNotNull(inboxConversations.providerChatId),
    ));
    return new Set(rows.map((r) => r.t).filter((x): x is string => !!x));
  },
  async threadsConnus(userId, threadIds) {
    if (threadIds.length === 0) return [];
    return db.select({ threadId: mailsEnAttente.threadId, taskId: mailsEnAttente.taskId, createdAt: mailsEnAttente.createdAt })
      .from(mailsEnAttente)
      .where(and(eq(mailsEnAttente.userId, userId), inArray(mailsEnAttente.threadId, threadIds)));
  },
  async reserver(userId, l, maintenant) {
    // Une ligne existante n'est reprise que sans tâche et périmée (même règle que ligneLibre),
    // dans la même instruction : deux passages ne peuvent pas la prendre tous les deux.
    const valeurs = { expediteur: l.expediteur, sujet: l.sujet, dernierMessageAt: l.dernierMessageAt, createdAt: maintenant };
    const r = await db.insert(mailsEnAttente).values({ userId, threadId: l.threadId, ...valeurs })
      .onConflictDoUpdate({
        target: [mailsEnAttente.userId, mailsEnAttente.threadId],
        set: valeurs,
        setWhere: and(
          isNull(mailsEnAttente.taskId),
          lt(mailsEnAttente.createdAt, new Date(maintenant.getTime() - RESERVATION_PERIMEE_MS)),
        ),
      })
      .returning({ id: mailsEnAttente.id });
    return r.length > 0;
  },
  async tacheDuFil(userId, threadId) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(
      eq(tasks.userId, userId), eq(tasks.source, "fil_mail"),
      sql`${tasks.actionData} -> 'mail' ->> 'threadId' = ${threadId}`,
    )).orderBy(desc(tasks.id)).limit(1);
    return t?.id ?? null;
  },
  async liberer(userId, threadId) {
    // Seulement une réservation restée sans tâche.
    await db.delete(mailsEnAttente).where(and(
      eq(mailsEnAttente.userId, userId), eq(mailsEnAttente.threadId, threadId), isNull(mailsEnAttente.taskId),
    ));
  },
  async lierTache(userId, threadId, taskId) {
    await db.update(mailsEnAttente).set({ taskId })
      .where(and(eq(mailsEnAttente.userId, userId), eq(mailsEnAttente.threadId, threadId)));
  },
  async candidats(userId) {
    const [c, p, l] = await Promise.all([
      db.select({ id: clients.id, email: clients.email, projectId: clients.parentProjectId, actif: clients.isActive })
        .from(clients).where(and(eq(clients.userId, userId), isNotNull(clients.email))),
      db.select({ id: projects.id, contact: projects.clientContact })
        .from(projects).where(and(eq(projects.userId, userId), isNotNull(projects.clientContact))),
      db.select({ id: leads.id, email: leads.email, projectId: leads.projectId })
        .from(leads).where(and(eq(leads.userId, userId), isNotNull(leads.email))),
    ]);
    return { clients: c.filter((x) => x.actif !== false), projets: p, leads: l };
  },
  // Carte chargée une fois par passage ; hors interrupteur ou carte illisible : {} (consigné).
  rattacheur: (userId) => rattacheurDuPassage(userId),
  async premierJourTravaille(userId, jour) {
    const { isWorkDay } = await joursTravailles(storage as any, userId, jour, plusJours(jour, 30));
    for (let j = jour, i = 0; i <= 30; j = plusJours(j, 1), i++) if (isWorkDay(j)) return j;
    return jour;
  },
  creerTache: (userId, donnees) => creerTache(userId, donnees),
};
