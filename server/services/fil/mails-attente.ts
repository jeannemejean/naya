// Fil conducteur, les mails qui attendent une réponse (spec §8.1). Naya lit la boîte Gmail
// déjà reliée (Unipile, compte de l'utilisatrice) : un fil des 14 derniers jours dont le dernier
// message vient d'un humain identifiable, et pas d'elle, devient une tâche « Répondre à X :
// objet » (échéance à +2 jours, +7 pour l'administratif), rattachée si possible au projet, au
// client ou au prospect de l'expéditeur.
//
// Exclus : envois automatiques, listes et newsletters, notifications, et les prospects (leurs
// réponses sont déjà dans « Réponses »). La ligne `mails_en_attente` est la clé de non-doublon :
// un `thread_id` déjà présent ne crée plus jamais de tâche, même cochée ou supprimée.
//
// Les en-têtes (List-Unsubscribe, Auto-Submitted, Precedence) sont demandés à Unipile
// (`include_headers=true`) ; un mail renvoyé sans en-têtes n'est jugé que sur son adresse.
import type { EmailUnipile } from "../unipile-mail";
import type { BrouillonTache, Rattachement } from "./rattachement";

export const FENETRE_JOURS = 14;
export const ECHEANCE_JOURS = 2;
export const ECHEANCE_ADMIN_JOURS = 7;
// Pas de journée surchargée : le reste est repris au passage suivant (tant qu'il a moins de 14 jours).
export const PLAFOND_PAR_PASSAGE = 10;
// Une réservation restée sans tâche (passage interrompu) se libère au bout d'une heure.
export const RESERVATION_PERIMEE_MS = 3600_000;

const JOUR_MS = 24 * 3600_000;

const normaliser = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── Le tri ───────────────────────────────────────────────────────────────────────────

// Adresses de robots, lues dans la partie locale (avant @).
// Séparateurs . _ + - (no-reply, no_reply, noreply_x…).
const LOCAL_ROBOT = /(^|[._+-])(no[-_]?reply|do[-_]?not[-_]?reply|notifications?|newsletters?|mailer[-_]?daemon)([._+-]|$)/i;

/** Vrai si les en-têtes disent un envoi automatique ou de masse. */
function enTetesDeMasse(h: Record<string, string> | null): boolean {
  if (!h) return false;
  if ("list-unsubscribe" in h) return true;
  const auto = (h["auto-submitted"] ?? "").trim().toLowerCase();
  if ("auto-submitted" in h && auto !== "no") return true;
  if (/^(bulk|list|junk|auto_reply)$/.test((h["precedence"] ?? "").trim().toLowerCase())) return true;
  return false;
}

// Liste fermée (spec) : facture, URSSAF, impôts, banque, contrat, devis signé, administratif, attestation.
const ADMINISTRATIF = /\b(factures?|urssaf|impots?|banques?|contrats?|devis signes?|administratif|administrative|attestations?)\b/;

/** Vrai si le sujet relève de l'administratif (échéance plus longue). */
export function estAdministratif(sujet: string): boolean {
  return ADMINISTRATIF.test(normaliser(sujet));
}

/** Sujet sans ses préfixes de réponse ou de transfert (Re:, TR:, Fwd:…). */
function sujetPropre(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 5; i++) {
    const u = t.replace(/^\s*(re|tr|fw|fwd|réf|ref)\s*(\[\d+\])?\s*:\s*/i, "");
    if (u === t) break;
    t = u;
  }
  return t.trim();
}

export interface FilEnAttente {
  threadId: string; expediteur: string; nom: string; sujet: string; dernierAt: Date; administratif: boolean;
}

/**
 * Les fils qui attendent une réponse (PUR). Le dernier message d'un fil (brouillons ignorés)
 * décide : moins de 14 jours, pas envoyé par l'utilisatrice ni depuis une de ses adresses, pas
 * à la corbeille ni en spam, d'un humain (adresse et en-têtes), pas d'un prospect, adressé à
 * elle (pas seulement en copie) quand les destinataires sont connus. Les plus
 * récents d'abord.
 */
export function filsEnAttente(
  emails: EmailUnipile[], adressesPropres: Set<string>, adressesProspects: Set<string>, maintenant: Date,
): FilEnAttente[] {
  const propres = new Set(Array.from(adressesPropres, (a) => a.toLowerCase()));
  const prospects = new Set(Array.from(adressesProspects, (a) => a.toLowerCase()));
  const derniers = new Map<string, EmailUnipile>();
  for (const e of emails) {
    if (e.role === "drafts") continue;
    // Un message sans fil est son propre fil.
    const fil = e.threadId ?? `mail:${e.id}`;
    const avant = derniers.get(fil);
    if (!avant || Date.parse(e.date) > Date.parse(avant.date)) derniers.set(fil, e);
  }
  const t = maintenant.getTime();
  const retenus: FilEnAttente[] = [];
  derniers.forEach((m, threadId) => {
    const at = Date.parse(m.date);
    if (!(t - at < FENETRE_JOURS * JOUR_MS) || at > t) return;
    if (m.role === "sent" || m.role === "trash" || m.role === "spam") return;
    if (m.folders.some((f) => /(^|\/)(sent|trash|spam)$/i.test(f))) return;
    const email = m.from?.email;
    if (!email || propres.has(email) || prospects.has(email)) return;
    // Jeanne seulement en copie : on ne lui demande rien. Sans destinataires dans les données, on ne juge pas.
    if (m.to.length > 0 && !m.to.some((a) => propres.has(a.toLowerCase()))) return;
    if (LOCAL_ROBOT.test(email.split("@")[0] ?? "")) return;
    if (enTetesDeMasse(m.headers)) return;
    const sujet = sujetPropre(m.sujet);
    retenus.push({
      threadId, expediteur: email, nom: m.from?.nom?.trim() || email, sujet,
      dernierAt: new Date(at), administratif: estAdministratif(sujet),
    });
  });
  return retenus.sort((a, b) => b.dernierAt.getTime() - a.dernierAt.getTime());
}

// ── La correspondance avec un projet, un client ou un prospect ─────────────────────────

export interface CandidatsRattachement {
  clients: Array<{ id: number; email: string | null; projectId: number }>;
  /** `contact` : le champ libre `projects.client_contact` (on y cherche des adresses). */
  projets: Array<{ id: number; contact: string | null }>;
  leads: Array<{ id: number; email: string | null; projectId: number | null }>;
}
export interface Correspondance { projectId: number | null; clientId: number | null; leadId: number | null }

// Domaines de messagerie grand public : un domaine partagé ne désigne personne.
const DOMAINES_PUBLICS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "mac.com", "aol.com", "orange.fr", "wanadoo.fr",
  "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "proton.me", "protonmail.com", "gmx.fr", "gmx.com",
]);

const domaineDe = (a: string) => a.slice(a.lastIndexOf("@") + 1).toLowerCase();
const adressesDans = (texte: string | null): string[] =>
  (texte ?? "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];

/**
 * Le projet, le client ou le prospect de l'expéditeur (PUR) : adresse exacte d'abord (client,
 * projet, prospect), puis même domaine, sauf domaine grand public ou de l'utilisatrice. Un
 * domaine qui mène à plusieurs projets est ambigu : rien.
 */
export function correspondanceMail(
  adresse: string, c: CandidatsRattachement, domainesPropres: Set<string>,
): Correspondance | null {
  const a = adresse.toLowerCase();
  const client = c.clients.find((x) => x.email?.toLowerCase() === a);
  if (client) return { projectId: client.projectId, clientId: client.id, leadId: null };
  const projet = c.projets.find((x) => adressesDans(x.contact).includes(a));
  if (projet) return { projectId: projet.id, clientId: null, leadId: null };
  const lead = c.leads.find((x) => x.email?.toLowerCase() === a);
  if (lead) return { projectId: lead.projectId, clientId: null, leadId: lead.id };

  const d = domaineDe(a);
  if (!d || DOMAINES_PUBLICS.has(d) || domainesPropres.has(d)) return null;
  const memeDomaine = (e: string | null | undefined) => !!e && e.includes("@") && domaineDe(e) === d;
  const unique = <T>(trouves: T[], projetDe: (x: T) => number | null): T | null | "ambigu" => {
    if (trouves.length === 0) return null;
    return new Set(trouves.map(projetDe)).size === 1 ? trouves[0] : "ambigu";
  };
  const cl = unique(c.clients.filter((x) => memeDomaine(x.email)), (x) => x.projectId);
  if (cl === "ambigu") return null;
  if (cl) return { projectId: cl.projectId, clientId: cl.id, leadId: null };
  const pr = unique(c.projets.filter((x) => adressesDans(x.contact).some(memeDomaine)), (x) => x.id);
  if (pr === "ambigu") return null;
  if (pr) return { projectId: pr.id, clientId: null, leadId: null };
  const ld = unique(c.leads.filter((x) => memeDomaine(x.email)), (x) => x.projectId);
  if (ld === "ambigu") return null;
  if (ld) return { projectId: ld.projectId, clientId: null, leadId: ld.id };
  return null;
}

// ── Le passage du matin ────────────────────────────────────────────────────────────────

export interface LigneMail { threadId: string; taskId: number | null; createdAt: Date | null }

/**
 * Vrai si le fil peut (re)donner une tâche : aucune ligne, ou une réservation sans tâche de plus
 * d'une heure. Une ligne qui porte une tâche ne se libère JAMAIS (tâche cochée ou supprimée comprise).
 */
export function ligneLibre(l: LigneMail | undefined, maintenant: Date): boolean {
  if (!l) return true;
  if (l.taskId != null) return false;
  return l.createdAt != null && maintenant.getTime() - l.createdAt.getTime() > RESERVATION_PERIMEE_MS;
}

export interface DepsMails {
  /** Le compte Gmail Unipile de l'utilisatrice ; null s'il est absent ou déconnecté. */
  compteEmail(userId: string): Promise<string | null>;
  listerEmails(accountId: string, depuis: Date): Promise<EmailUnipile[]>;
  /** Les adresses de l'utilisatrice : compte, adresse de connexion, expéditeurs configurés. */
  adressesPropres(userId: string, accountId: string): Promise<Set<string>>;
  /** Les adresses de ses prospects (leads). */
  adressesProspects(userId: string): Promise<Set<string>>;
  /** Les fils Gmail déjà suivis dans « Réponses » (inbox_conversations, canal email). */
  threadsProspects(userId: string): Promise<Set<string>>;
  /** Les lignes `mails_en_attente` existantes pour ces fils. */
  threadsConnus(userId: string, threadIds: string[]): Promise<LigneMail[]>;
  /**
   * Insère la ligne (sans tâche), à `maintenant` ; sur une ligne existante, ne la reprend que si
   * `ligneLibre` (sans tâche et périmée), atomiquement. Faux si le fil est pris.
   */
  reserver(userId: string, ligne: { threadId: string; expediteur: string; sujet: string; dernierMessageAt: Date }, maintenant: Date): Promise<boolean>;
  liberer(userId: string, threadId: string): Promise<void>;
  /** La tâche déjà créée pour ce fil (source fil_mail, actionData.mail.threadId), ou null. */
  tacheDuFil(userId: string, threadId: string): Promise<number | null>;
  lierTache(userId: string, threadId: string, taskId: number): Promise<void>;
  candidats(userId: string): Promise<CandidatsRattachement>;
  /** Le rattacheur d'un passage (rattacheurDuPassage : carte chargée une fois, erreurs absorbées). */
  rattacheur(userId: string): (b: BrouillonTache) => Promise<Partial<Rattachement>>;
  /** Le premier jour travaillé à partir de `jour` (YYYY-MM-DD). */
  premierJourTravaille(userId: string, jour: string): Promise<string>;
  creerTache(userId: string, donnees: Record<string, unknown>): Promise<{ ok: true; tache: { id: number } } | { ok: false; status: number; message: string }>;
}

// Paris : le jour de l'utilisatrice (le serveur tourne en UTC).
function jourParis(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const borner = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/**
 * Crée une tâche par fil en attente encore inconnu (au plus PLAFOND_PAR_PASSAGE). Sans compte
 * Gmail relié : `{ creees: 0 }`, sans erreur. Une boîte illisible lève (le planificateur consigne).
 * La ligne est réservée AVANT la tâche (deux passages simultanés ne créent pas deux tâches) et
 * rendue si la tâche n'a pas pu être créée.
 */
export async function synchroniserMailsEnAttente(
  userId: string, maintenant: Date, deps?: DepsMails,
): Promise<{ creees: number }> {
  const d = deps ?? (await import("./mails-attente-deps")).depsMails;
  const compte = await d.compteEmail(userId);
  if (!compte) return { creees: 0 };

  const emails = await d.listerEmails(compte, new Date(maintenant.getTime() - FENETRE_JOURS * JOUR_MS));
  const propres = await d.adressesPropres(userId, compte);
  // Une réponse de prospect est déjà dans « Réponses » : exclue par son adresse, ou par son fil.
  const suivis = await d.threadsProspects(userId);
  const fils = filsEnAttente(emails, propres, await d.adressesProspects(userId), maintenant)
    .filter((f) => !suivis.has(f.threadId));
  if (fils.length === 0) return { creees: 0 };
  const lignes = new Map((await d.threadsConnus(userId, fils.map((f) => f.threadId))).map((l) => [l.threadId, l]));
  const nouveaux = fils.filter((f) => ligneLibre(lignes.get(f.threadId), maintenant)).slice(0, PLAFOND_PAR_PASSAGE);
  if (nouveaux.length === 0) return { creees: 0 };

  const candidats = await d.candidats(userId);
  const domainesPropres = new Set(Array.from(propres, (a) => domaineDe(a)));
  const jour = await d.premierJourTravaille(userId, jourParis(maintenant));
  const rattacher = d.rattacheur(userId);
  let creees = 0;
  for (const f of nouveaux) {
    if (!(await d.reserver(userId, { threadId: f.threadId, expediteur: f.expediteur, sujet: f.sujet, dernierMessageAt: f.dernierAt }, maintenant))) continue;
    // Réservation périmée reprise : une tâche a pu être créée sans que le lien soit écrit.
    // On la cherche, on répare le lien, et on n'en crée pas une deuxième.
    if (lignes.has(f.threadId)) {
      const existante = await d.tacheDuFil(userId, f.threadId);
      if (existante != null) {
        await d.lierTache(userId, f.threadId, existante).catch((e: any) =>
          console.error(`[fil] mail en attente : lien non réparé user=${userId}:`, e?.message ?? e));
        continue;
      }
    }
    // Dès qu'une tâche existe, la ligne n'est plus rendue (voir plus bas).
    let tacheCreee: number | null = null;
    try {
      const m = correspondanceMail(f.expediteur, candidats, domainesPropres);
      const rattachement = m ? await rattacher({ projectId: m.projectId, leadId: m.leadId }) : {};
      const r = await d.creerTache(userId, {
        title: borner(`Répondre à ${f.nom} : ${f.sujet || "(sans objet)"}`, 200),
        type: m?.leadId != null ? "outreach" : "admin",
        category: m?.leadId != null ? "conversion" : "trust",
        priority: 2,
        estimatedDuration: 10,
        scheduledDate: jour,
        dueDate: new Date(maintenant.getTime() + (f.administratif ? ECHEANCE_ADMIN_JOURS : ECHEANCE_JOURS) * JOUR_MS),
        projectId: m?.projectId ?? null,
        clientId: m?.clientId ?? null,
        leadId: m?.leadId ?? null,
        ...rattachement,
        source: "fil_mail",
        completed: false,
        actionData: { mail: { threadId: f.threadId, expediteur: f.expediteur } },
      });
      if (!r.ok) {
        console.warn(`[fil] mail en attente : tâche refusée (${r.status} ${r.message}) user=${userId}`);
        await d.liberer(userId, f.threadId);
        continue;
      }
      tacheCreee = r.tache.id;
      creees++;
      await d.lierTache(userId, f.threadId, r.tache.id);
    } catch (e: any) {
      if (tacheCreee != null) {
        // Tâche créée, lien non écrit : la ligne reste ; le passage qui la trouverait périmée
        // retrouve la tâche par `tacheDuFil` et répare le lien.
        console.error(`[fil] mail en attente : tâche ${tacheCreee} créée, lien non écrit user=${userId}:`, e?.message ?? e);
        continue;
      }
      console.error(`[fil] mail en attente : création impossible user=${userId}:`, e?.message ?? e);
      await d.liberer(userId, f.threadId).catch(() => {});
    }
  }
  return { creees };
}
