/**
 * Relances demandées par le prospect (« on se reparle début 2027 ») : proposition sous la
 * réponse, validation (tâche datée + brouillon rédigé tout de suite), « Non merci ».
 *
 * Invariants :
 *  - RIEN n'est jamais envoyé ici. Le brouillon est rangé dans la tâche ; le jour venu,
 *    l'utilisatrice le relit dans « Ta réponse » et l'envoie par le flux d'envoi habituel
 *    (qui applique désinscription / « ne plus contacter »).
 *  - Seul le texte NOUVEAU d'une vraie réponse compte (texteNouveau) : une date citée de notre
 *    propre email ne produit jamais de proposition.
 *  - Une seule tâche par message, même sur double clic : la décision est RÉSERVÉE (`en_cours`)
 *    par une écriture atomique avant tout travail, puis posée `validee` avec l'id de la tâche.
 *  - Tant que la relance attend, la séquence du prospect reste arrêtée : `stopped_replied` ne
 *    se quitte que par « Ce n'était pas une vraie réponse », qui tient compte des relances
 *    (voir routes-reponses.ts) ; la validation arrête aussi toute séquence encore en cours.
 *  - On ne journalise jamais le contenu des messages.
 */
import type { InboxConversation, InboxMessage, Lead, LeadSequenceState, Task } from "@shared/schema";
import { texteNouveau } from "@shared/citation";
import { detecterRelance, HORIZON_JOURS, jourDans, premierJourTravaille, type RelanceDetectee } from "./relance-date";
import { relancesDe, RESERVATION_RELANCE_MS, SOURCE_TACHE_RELANCE, type DecisionRelance } from "./relance-etat";
import type { DemandeRelance } from "./proposition";

export interface PrefsRelance { timezone?: string | null; workDays?: string | null }

const JOURS_DEFAUT = "mon,tue,wed,thu,fri";
const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function joursTravailDe(prefs: PrefsRelance | null | undefined): Set<string> {
  const csv = prefs?.workDays;
  if (csv == null) return new Set(JOURS_DEFAUT.split(","));
  return new Set(csv.split(",").map((d) => d.trim().toLowerCase()).filter((d) => JOURS.includes(d)));
}
const fuseauDe = (prefs: PrefsRelance | null | undefined) => prefs?.timezone || "UTC";

/** Un message entrant « vraie réponse » ? Seuls ceux-là peuvent porter une relance. */
export const estReponseEntrante = (m: Pick<InboxMessage, "sens" | "nature">) => m.sens === "entrant" && m.nature === "reponse";

/** Demande de relance lue dans le texte NOUVEAU d'une vraie réponse (jamais dans la citation). */
export function relanceDuMessage(m: InboxMessage, prefs: PrefsRelance | null | undefined): RelanceDetectee | null {
  if (!estReponseEntrante(m)) return null;
  const nouveau = texteNouveau(m.body);
  if (!nouveau) return null;
  return detecterRelance(nouveau, { reference: new Date(m.sentAt), fuseau: fuseauDe(prefs), joursTravail: joursTravailDe(prefs) });
}

/** Prénom pour le titre (« Relancer Claire (Acme) »). */
export const prenomDe = (nom: string | null | undefined) => (nom ?? "").trim().split(/\s+/)[0] || (nom ?? "").trim();

export function titreRelance(lead: Pick<Lead, "name" | "company">): string {
  return `Relancer ${prenomDe(lead.name)}${lead.company ? ` (${lead.company})` : ""}`;
}

/** Ce qu'affiche le fil sous une réponse. */
export type VueRelance =
  | { statut: "proposee"; date: string }
  | { statut: "en_cours"; date: string | null }
  | { statut: "validee"; date: string | null; taskId: number; faite: boolean };

/** Brouillon prêt pour le compositeur : relance validée, pas faite, dont le jour est arrivé. */
export interface RelancePrete { taskId: number; messageId: number; date: string; texte: string }

export interface DepsVue {
  now: () => Date;
  getTask: (id: number) => Promise<Task | undefined>;
}

/** Une réservation `en_cours` abandonnée (processus tombé en route) ne compte plus. */
export function enCoursActive(d: DecisionRelance | undefined, now: Date): boolean {
  return d?.statut === "en_cours" && !(Date.parse(d.le) < now.getTime() - RESERVATION_RELANCE_MS);
}

/** Texte nouveau sur une ligne, pour citer la phrase du prospect. */
const extraitDe = (m: InboxMessage) => texteNouveau(m.body).replace(/\s+/g, " ").trim().slice(0, 240);

/**
 * Relances à montrer pour une conversation : par message entrant (proposition, validée…), et
 * le brouillon prêt à être repris dans « Ta réponse » le jour venu.
 */
export async function vueRelances(
  conv: Pick<InboxConversation, "etatAvantReponse">, messages: InboxMessage[], prefs: PrefsRelance | null | undefined, deps: DepsVue,
  /** Prospect désinscrit ou sur « ne plus contacter » : aucune proposition, aucun brouillon prêt. */
  opts: { bloque?: boolean } = {},
): Promise<{ parMessage: Record<number, VueRelance>; prete: RelancePrete | null }> {
  const decisions = relancesDe(conv.etatAvantReponse);
  const aujourdhui = jourDans(deps.now(), fuseauDe(prefs));
  const parMessage: Record<number, VueRelance> = {};
  let prete: RelancePrete | null = null;
  for (const m of messages) {
    if (!estReponseEntrante(m)) continue;
    const d = decisions[String(m.id)];
    if (d?.statut === "refusee" || d?.statut === "annulee") continue;
    if (d?.statut === "validee" && d.taskId != null) {
      const t = await deps.getTask(d.taskId);
      if (!t || t.archivedAt) continue; // tâche retirée du planning : plus rien à montrer
      // Jamais prête avant la date convenue, même si la tâche a été avancée dans le planning.
      const date = [t.scheduledDate, d.date].filter((x): x is string => !!x).sort().pop() ?? null;
      parMessage[m.id] = { statut: "validee", date, taskId: t.id, faite: !!t.completed };
      const texte = (t.actionData as any)?.relance?.texte;
      if (!opts.bloque && !t.completed && date && date <= aujourdhui && typeof texte === "string" && texte.trim()) {
        if (!prete || date > prete.date) prete = { taskId: t.id, messageId: m.id, date, texte };
      }
      continue;
    }
    if (enCoursActive(d, deps.now())) { parMessage[m.id] = { statut: "en_cours", date: d!.date ?? null }; continue; }
    if (opts.bloque) continue;
    const r = relanceDuMessage(m, prefs);
    if (r && r.date > aujourdhui) parMessage[m.id] = { statut: "proposee", date: r.date };
  }
  return { parMessage, prete };
}

// ─── Validation / refus ─────────────────────────────────────────────────────────

export type RaisonRelance =
  | "introuvable" | "pas_de_date" | "date_invalide" | "date_passee" | "jour_non_travaille"
  | "refusee" | "en_cours" | "tache_refusee" | "desinscrit";
export type IssueRelance =
  | { ok: true; taskId: number; date: string; deja?: boolean }
  | { ok: false; status: number; raison: RaisonRelance; message?: string };

export interface DepsRelance {
  now: () => Date;
  getConversation: (id: number, userId: string) => Promise<InboxConversation | undefined>;
  getMessages: (conversationId: number) => Promise<InboxMessage[]>;
  getLead: (leadId: number, userId: string) => Promise<Lead | undefined>;
  getPrefs: (userId: string) => Promise<PrefsRelance | null | undefined>;
  getTask: (id: number) => Promise<Task | undefined>;
  /** Désinscrit ou sur « ne plus contacter » (storage.isLeadUnsubscribed). Lève sur erreur de lecture. */
  estDesinscrit: (leadId: number, userId: string) => Promise<boolean>;
  reserver: (conversationId: number, messageId: number, now: Date) => Promise<boolean>;
  /** Pose la décision ; avec `siEnCoursLe`, seulement si c'est encore CETTE réservation (`en_cours`, même `le`). */
  ecrire: (conversationId: number, messageId: number, d: DecisionRelance | null, siEnCoursLe?: string) => Promise<unknown>;
  refuser: (conversationId: number, messageId: number, now: Date) => Promise<boolean>;
  /** creerTache (server/services/taches/ecrire-tache.ts) : jours travaillés, créneau libre. */
  creerTache: (userId: string, donnees: Record<string, unknown>) =>
    Promise<{ ok: true; tache: Task } | { ok: false; status: number; message: string }>;
  /** Rédaction par la machinerie des réponses (proposerReponse en mode relance). */
  rediger: (userId: string, conversationId: number, relance: DemandeRelance) => Promise<string>;
  etatSequence: (leadId: number) => Promise<LeadSequenceState | undefined>;
  /** Arrête la séquence (stopped_replied, nextRunAt nul) : plus rien ne la relance seule. */
  arreterSequence: (leadId: number) => Promise<unknown>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateValide = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const erreurSure = (e: any) => String(e?.message ?? e).split(/\bparams:/)[0].slice(0, 160);

/** Statuts d'une séquence encore en marche : une relance validée les arrête. */
const SEQUENCE_EN_MARCHE = new Set(["active", "awaiting_linkedin", "paused"]);

async function messageEtContexte(userId: string, conversationId: number, messageId: number, deps: DepsRelance) {
  const conv = await deps.getConversation(conversationId, userId);
  if (!conv) return null;
  const msg = (await deps.getMessages(conv.id)).find((m) => m.id === messageId);
  if (!msg || !estReponseEntrante(msg)) return null;
  return { conv, msg };
}

/**
 * « Valider » (date détectée) ou « Changer la date » (`dateChoisie`) : crée UNE tâche datée,
 * rédige la relance maintenant et la range dans la tâche. Idempotent (double clic → la même
 * tâche). Rien n'est envoyé.
 */
export async function validerRelance(
  userId: string, conversationId: number, messageId: number, dateChoisie: string | null | undefined, deps: DepsRelance,
): Promise<IssueRelance> {
  const trouve = await messageEtContexte(userId, conversationId, messageId, deps);
  if (!trouve) return { ok: false, status: 404, raison: "introuvable" };
  const { conv, msg } = trouve;
  const lead = await deps.getLead(conv.leadId, userId);
  if (!lead) return { ok: false, status: 404, raison: "introuvable" };
  const prefs = await deps.getPrefs(userId);
  const now = deps.now();

  // Jamais de relance pour un prospect désinscrit (lecture impossible → refus, comme l'envoi).
  let desinscrit = true;
  try { desinscrit = await deps.estDesinscrit(lead.id, userId); } catch (e: any) {
    console.error(`[Relance] désinscription illisible (lead ${lead.id}) — relance refusée : ${erreurSure(e)}`);
  }
  if (desinscrit) return { ok: false, status: 409, raison: "desinscrit" };

  // Déjà validée (double clic arrivé après la fin du premier) : la même tâche.
  const deja = relancesDe(conv.etatAvantReponse)[String(messageId)];
  if (deja?.statut === "validee" && deja.taskId != null && (await deps.getTask(deja.taskId))) {
    return { ok: true, taskId: deja.taskId, date: deja.date ?? "", deja: true };
  }

  const detectee = relanceDuMessage(msg, prefs);
  let date: string;
  if (dateChoisie != null && dateChoisie !== "") {
    if (!dateValide(dateChoisie)) return { ok: false, status: 400, raison: "date_invalide" };
    if (premierJourTravaille(dateChoisie, joursTravailDe(prefs)) !== dateChoisie) {
      return { ok: false, status: 400, raison: "jour_non_travaille" };
    }
    date = dateChoisie;
    const ecart = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${jourDans(now, fuseauDe(prefs))}T00:00:00Z`)) / 86_400_000;
    if (ecart > HORIZON_JOURS) return { ok: false, status: 400, raison: "date_invalide" };
  } else {
    if (!detectee) return { ok: false, status: 409, raison: "pas_de_date" };
    date = detectee.date;
  }
  if (date <= jourDans(now, fuseauDe(prefs))) return { ok: false, status: 400, raison: "date_passee" };

  // Réservation atomique : la seconde requête d'un double clic s'arrête ici.
  if (!(await deps.reserver(conv.id, messageId, now))) {
    const relue = await deps.getConversation(conv.id, userId);
    const d = relancesDe(relue?.etatAvantReponse)[String(messageId)];
    if (d?.statut === "validee" && d.taskId != null) return { ok: true, taskId: d.taskId, date: d.date ?? date, deja: true };
    return d?.statut === "refusee" || d?.statut === "annulee"
      ? { ok: false, status: 409, raison: "refusee" }
      : { ok: false, status: 409, raison: "en_cours" };
  }

  // Ne libère que SA réservation (jamais celle d'une autre requête qui l'aurait reprise).
  const liberer = () => deps.ecrire(conv.id, messageId, null, now.toISOString())
    .catch((e: any) => console.error(`[Relance] réservation non libérée (conversation ${conv.id}) : ${erreurSure(e)}`));
  let creee: number | null = null;
  try {
    const extrait = detectee?.extrait || extraitDe(msg);
    const texte = await deps.rediger(userId, conv.id, { date, extrait });
    const r = await deps.creerTache(userId, {
      title: titreRelance(lead),
      type: "outreach",
      category: "conversion",
      leadId: lead.id,
      projectId: lead.projectId ?? conv.projectId ?? null,
      scheduledDate: date,
      estimatedDuration: 10,
      source: SOURCE_TACHE_RELANCE,
      actionData: {
        lien: `/outreach?onglet=reponses&conversation=${conv.id}`,
        relance: { conversationId: conv.id, messageId, date, canal: conv.channel, texte },
      },
    });
    if (!r.ok) {
      await liberer();
      return { ok: false, status: r.status, raison: r.status === 400 ? "jour_non_travaille" : "tache_refusee", message: r.message };
    }
    creee = r.tache.id;
    await deps.ecrire(conv.id, messageId, { statut: "validee", le: now.toISOString(), taskId: r.tache.id, date: r.tache.scheduledDate ?? date });

    // La séquence reste à l'arrêt jusqu'à la relance (elle l'est déjà après une vraie réponse).
    try {
      const etat = await deps.etatSequence(lead.id);
      if (etat && SEQUENCE_EN_MARCHE.has(etat.status)) await deps.arreterSequence(lead.id);
    } catch (e: any) {
      console.error(`[Relance] séquence du lead ${lead.id} non vérifiée : ${erreurSure(e)}`);
    }
    return { ok: true, taskId: r.tache.id, date: r.tache.scheduledDate ?? date };
  } catch (e) {
    // Tâche déjà créée : on ne libère pas (une nouvelle validation en créerait une seconde).
    if (creee == null) await liberer();
    else console.error(`[Relance] tâche ${creee} créée mais décision non enregistrée (conversation ${conv.id}) : ${erreurSure(e)}`);
    throw e;
  }
}

/** « Non merci » : la proposition ne revient plus pour ce message. */
export async function refuserRelance(
  userId: string, conversationId: number, messageId: number, deps: DepsRelance,
): Promise<{ ok: true } | { ok: false; status: number; raison: "introuvable" | "deja_validee" }> {
  const trouve = await messageEtContexte(userId, conversationId, messageId, deps);
  if (!trouve) return { ok: false, status: 404, raison: "introuvable" };
  if (await deps.refuser(trouve.conv.id, messageId, deps.now())) return { ok: true };
  return { ok: false, status: 409, raison: "deja_validee" };
}

/** « Proposer une autre version » : nouvelle rédaction de la relance validée (rien n'est enregistré ni envoyé). */
export async function reformulerRelance(
  userId: string, conversationId: number, messageId: number, deps: DepsRelance,
): Promise<{ ok: true; texte: string } | { ok: false; status: number }> {
  const trouve = await messageEtContexte(userId, conversationId, messageId, deps);
  if (!trouve) return { ok: false, status: 404 };
  const d = relancesDe(trouve.conv.etatAvantReponse)[String(messageId)];
  if (d?.statut !== "validee" || d.taskId == null) return { ok: false, status: 409 };
  const t = await deps.getTask(d.taskId);
  const date = t?.scheduledDate ?? d.date;
  if (!date) return { ok: false, status: 409 };
  const prefs = await deps.getPrefs(userId);
  const extrait = relanceDuMessage(trouve.msg, prefs)?.extrait || extraitDe(trouve.msg);
  return { ok: true, texte: await deps.rediger(userId, trouve.conv.id, { date, extrait }) };
}

/**
 * « Ce n'était pas une vraie réponse » sur le dernier message entrant `requalifie` :
 *  - sa propre relance (pas faite) est annulée et sa tâche supprimée — elle n'a plus d'objet ;
 *  - une relance validée sur un AUTRE message de la conversation attend encore → `true` :
 *    la séquence ne doit pas reprendre (elle relancerait le prospect avant la date convenue).
 */
export async function relancesAuRequalifier(
  conv: Pick<InboxConversation, "id" | "etatAvantReponse">, requalifie: number | null,
  deps: { getTask: (id: number) => Promise<Task | undefined>; supprimerTache: (id: number) => Promise<unknown>; ecrire: DepsRelance["ecrire"]; now: () => Date },
): Promise<boolean> {
  let autreEnAttente = false;
  for (const [k, d] of Object.entries(relancesDe(conv.etatAvantReponse))) {
    if (d.statut !== "validee" && d.statut !== "en_cours") continue;
    const t = d.taskId != null ? await deps.getTask(d.taskId) : undefined;
    if (Number(k) === requalifie) {
      if (t && !t.completed) await deps.supprimerTache(t.id);
      await deps.ecrire(conv.id, Number(k), { statut: "annulee", le: deps.now().toISOString() });
    } else if (enCoursActive(d, deps.now()) || (d.statut === "validee" && t && !t.completed && !t.archivedAt)) {
      autreEnAttente = true;
    }
  }
  return autreEnAttente;
}
