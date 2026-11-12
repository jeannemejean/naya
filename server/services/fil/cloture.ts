// Clôture du vendredi et réconciliation du lundi (spec §7, point 7, et §8 « Le message »).
//
// Clôture du vendredi (jour de Paris) : les tâches ouvertes depuis plus de 7 jours (non faites,
// non archivées, créées avant le début du jour d'il y a 7 jours, sans date ou prévues au plus tard
// aujourd'hui, pas déjà tranchées cette semaine) sont listées au matin pour être
// tranchées : faire aujourd'hui, déplacer, abandonner. Naya ne tranche JAMAIS seule : chaque geste
// vient de Jeanne (POST /api/fil/trancher). Jamais listées : les rituels (`ritualId`), les marqueurs
// de jalon (`type: milestone`), les tâches à heure fixe (`schedulingMode: fixed` : rituels et
// rendez-vous posés à l'heure ; le dépôt ne distingue pas d'autre « événement perso ») et la
// tâche de clôture elle-même (`source: fil_cloture`).
// Le vendredi, le passage du matin pose aussi UNE tâche de 15 min « Trancher les {n} tâches
// ouvertes », rattachée à rien, une fois par semaine ISO : la clé est en base (source
// `fil_cloture` + `actionData.cloture.semaine` = le lundi), donc un redémarrage n'en crée pas
// une deuxième, même cochée ou archivée (supprimée, la clé disparaît avec elle). Deux passages
// simultanés ne sont pas gardés en base : le planificateur ne tourne qu'une fois à la fois
// (`isAutoplannerRunning`, garde du processus) et c'est son seul appelant.
// Chaque geste (faire, déplacer, abandonner) pose `actionData.cloture.tranchee` = le lundi de la
// semaine : la tâche sort de la liste de ce vendredi, et peut revenir le suivant si elle reste ouverte.
//
// Réconciliation du lundi : les incohérences entre ce qui attend et les tâches censées s'en occuper.
// - reponses : une conversation `a_traiter` sans tâche (aucune, supprimée ou archivée), ou dont
//   la tâche est cochée alors que le dernier message n'est pas une réponse envoyée ;
// - appels_offres : score « fort », encore « repéré » ou « premier jet prêt » (Jeanne n'a ni lancé
//   la rédaction ni écarté), date limite à venir, hors avis écartés par la veille ;
// - posts : posts à valider (etatPost brouillon / a_rediger) prévus d'aujourd'hui à J+14, sans
//   tâche d'atelier (ou de validation) ouverte pour leur semaine, ni tâche ouverte du post lui-même ;
// - mails : `mails_en_attente` dont la tâche a disparu (supprimée), mail des 14 derniers jours. Une
//   tâche seulement cochée ou archivée ne remonte pas (la source filtre).
//
// Ce module n'importe ni la base ni le stockage : les sources sont injectées (cloture-deps.ts).
import { z } from "zod";
import type { Task } from "@shared/schema";
import { estEcarteParNaya, estPasse } from "@shared/appels-offres";
import { etatPost, lienAtelier, lundiDe, plusJours } from "@shared/atelier";
import { parisDayBoundsUTC, parisTodayString } from "../../utils/timezone";
import { debutJourParis, jourLong, jourParis, plateforme } from "./creation";

export const JOURS_OUVERTE = 7;
export const SOURCE_CLOTURE = "fil_cloture";
export const DUREE_CLOTURE = 15;
export const FENETRE_POSTS_JOURS = 14;
export const FENETRE_MAILS_JOURS = 14;
const JOUR_MS = 24 * 3600_000;
const VENDREDI = 5;
const LUNDI = 1;

export type ATrancher = { tacheId: number; titre: string; ouverteDepuis: number };
export type Incoherence = { source: string; libelle: string; lien: string };
type Refus = { ok: false; status: number; message: string };

const jourDeSemaine = (jour: string) => new Date(`${jour}T12:00:00Z`).getUTCDay();
const ecartJours = (de: string, a: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / JOUR_MS);

/** Ce qui n'est jamais à trancher : rituels, marqueurs de jalon, heure fixe, la clôture elle-même. */
const horsCloture = (t: Task) => t.ritualId != null || t.type === "milestone"
  || t.schedulingMode === "fixed" || t.source === SOURCE_CLOTURE;

/** Le lundi de la semaine où la tâche a déjà été tranchée (`actionData.cloture.tranchee`), ou null. */
export const trancheeLaSemaine = (t: Pick<Task, "actionData">): string | null => {
  const v = (t.actionData as any)?.cloture?.tranchee;
  return typeof v === "string" ? v : null;
};

// ── Clôture du vendredi ────────────────────────────────────────────────────────────────

/**
 * Les tâches ouvertes depuis plus de 7 jours (jours de Paris), le vendredi seulement ; sinon [].
 * Jamais : une tâche prévue après aujourd'hui (déjà placée plus tard : rien à trancher), ni une
 * tâche déjà tranchée cette semaine (elle peut revenir la semaine suivante si elle reste ouverte).
 */
export function aTrancher(taches: Task[], maintenant: Date): ATrancher[] {
  const aujourdhui = parisTodayString(maintenant);
  if (jourDeSemaine(aujourdhui) !== VENDREDI) return [];
  const semaine = lundiDe(aujourdhui);
  return taches
    .filter((t) => !t.completed && !t.archivedAt && t.createdAt && !horsCloture(t)
      && !(t.scheduledDate && t.scheduledDate > aujourdhui) && trancheeLaSemaine(t) !== semaine)
    .map((t) => ({ tacheId: t.id, titre: t.title, ouverteDepuis: ecartJours(parisTodayString(new Date(t.createdAt!)), aujourdhui) }))
    .filter((x) => x.ouverteDepuis > JOURS_OUVERTE)
    .sort((a, b) => b.ouverteDepuis - a.ouverteDepuis || a.tacheId - b.tacheId);
}

export const titreCloture = (n: number) => (n === 1 ? "Trancher la tâche ouverte" : `Trancher les ${n} tâches ouvertes`);

export interface DepsCloture {
  /** Tâches non faites, non archivées, créées avant cet instant, sans date ou prévues au plus tard ce jour (tous projets). */
  tachesOuvertes(userId: string, creeesAvant: Date, aujourdhui: string): Promise<Task[]>;
  /** Une tâche de clôture existe-t-elle déjà pour cette semaine (lundi YYYY-MM-DD), quel que soit son état ? */
  clotureDejaPosee(userId: string, semaine: string): Promise<boolean>;
  creerTache(userId: string, donnees: Record<string, unknown>): Promise<{ ok: true; tache: Task } | Refus>;
}

const depsClotureParDefaut = async (): Promise<DepsCloture> => (await import("./cloture-deps")).depsCloture;

/** La liste du vendredi ; un autre jour, [] sans rien lire. */
export async function clotureDuVendredi(userId: string, maintenant: Date, deps?: DepsCloture): Promise<ATrancher[]> {
  const aujourdhui = parisTodayString(maintenant);
  if (jourDeSemaine(aujourdhui) !== VENDREDI) return [];
  const d = deps ?? (await depsClotureParDefaut());
  // Ouverte depuis plus de 7 jours = créée avant le début (Paris) du jour d'il y a 7 jours.
  const avant = parisDayBoundsUTC(plusJours(aujourdhui, -JOURS_OUVERTE)).start;
  return aTrancher(await d.tachesOuvertes(userId, avant, aujourdhui), maintenant);
}

/**
 * Passage du matin, le vendredi : la tâche « Trancher les {n} tâches ouvertes » (15 min,
 * aujourd'hui, sans objectif ni projet), une seule fois par semaine ISO. Rien à trancher : rien.
 */
export async function poserTacheDeCloture(userId: string, maintenant: Date, deps?: DepsCloture): Promise<{ creee: boolean; n: number }> {
  const aujourdhui = parisTodayString(maintenant);
  if (jourDeSemaine(aujourdhui) !== VENDREDI) return { creee: false, n: 0 };
  const d = deps ?? (await depsClotureParDefaut());
  const liste = await clotureDuVendredi(userId, maintenant, d);
  if (liste.length === 0) return { creee: false, n: 0 };
  const semaine = lundiDe(aujourdhui);
  if (await d.clotureDejaPosee(userId, semaine)) return { creee: false, n: liste.length };
  const r = await d.creerTache(userId, {
    title: titreCloture(liste.length),
    description: "Pour chaque tâche ouverte depuis plus de 7 jours : la faire aujourd'hui, la déplacer ou l'abandonner. La liste est dans le mot du matin.",
    type: "planning", category: "planning", priority: 2,
    estimatedDuration: DUREE_CLOTURE, scheduledDate: aujourdhui,
    projectId: null, goalId: null, milestoneId: null,
    source: SOURCE_CLOTURE, completed: false,
    actionData: { cloture: { semaine }, lien: "/" },
  });
  if (!r.ok) {
    console.warn(`[fil] clôture du vendredi : tâche refusée user=${userId} (${r.status} ${r.message})`);
    return { creee: false, n: liste.length };
  }
  return { creee: true, n: liste.length };
}

// ── Trancher (geste de Jeanne) ─────────────────────────────────────────────────────────

const jourValide = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const demandeTrancher = z.object({
  tacheId: z.number().int().positive(),
  geste: z.enum(["faire", "deplacer", "abandonner"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(jourValide, "date_invalide").optional(),
});
export type DemandeTrancher = z.infer<typeof demandeTrancher>;

export interface DepsTrancher {
  /** La tâche si elle appartient à l'utilisatrice, sinon undefined. */
  lireTache(userId: string, id: number): Promise<Task | undefined>;
  modifierTache(userId: string, id: number, patch: Record<string, unknown>): Promise<{ ok: true; tache: Task } | Refus>;
  archiverTache(userId: string, id: number): Promise<{ ok: true; tache: Task } | Refus>;
  /** Pose `actionData.cloture.tranchee = semaine` (fusion, le reste d'actionData intact). */
  marquerTranchee(userId: string, id: number, semaine: string): Promise<void>;
}

/**
 * Le geste de Jeanne sur une tâche ouverte : `faire` la met aujourd'hui (Paris), `deplacer` à la
 * date donnée (aujourd'hui ou plus tard), `abandonner` l'archive (archivedAt, jamais supprimée).
 * Le jour change : l'heure est effacée, modifierTache en trouve une libre (et re-tasse).
 */
export async function trancher(userId: string, demande: DemandeTrancher, maintenant: Date, deps: DepsTrancher): Promise<{ ok: true; tache: Task } | Refus> {
  const aujourdhui = parisTodayString(maintenant);
  let date: string | null = null;
  if (demande.geste === "faire") date = aujourdhui;
  if (demande.geste === "deplacer") {
    if (!demande.date) return { ok: false, status: 400, message: "date_requise" };
    if (demande.date < aujourdhui) return { ok: false, status: 400, message: "date_passee" };
    date = demande.date;
  }
  const t = await deps.lireTache(userId, demande.tacheId);
  if (!t) return { ok: false, status: 404, message: "task_not_found" };
  if (t.completed || t.archivedAt) return { ok: false, status: 409, message: "deja_tranchee" };
  const r = demande.geste === "abandonner"
    ? await deps.archiverTache(userId, t.id)
    : await deps.modifierTache(userId, t.id, { scheduledDate: date, scheduledTime: null, scheduledEndTime: null });
  if (!r.ok) return r;
  // Tranchée cette semaine : elle sort de la liste du vendredi (même faite « aujourd'hui »). Le
  // geste est fait : une marque ratée est consignée, jamais présentée comme un échec du geste.
  const semaine = lundiDe(aujourdhui);
  try {
    await deps.marquerTranchee(userId, t.id, semaine);
  } catch (e: any) {
    console.error(`[fil] clôture : tâche ${t.id} tranchée mais non marquée user=${userId} :`, e?.message ?? e);
  }
  return { ok: true, tache: r.tache };
}

// ── Réconciliation du lundi ────────────────────────────────────────────────────────────

export interface ConversationATraiter {
  id: number; nom: string | null; canal: string; taskId: number | null;
  /** La tâche liée si elle existe encore, sinon null. */
  tache: { completed: boolean; archivedAt: Date | null } | null;
  /** Sens du dernier message de la conversation. */
  dernierSens: string | null;
}
export interface AOReconciliation {
  id: number; objet: string; acheteur: string | null; scoreAdequation: string | null; statut: string;
  dateLimite: Date | null; bloquants: string | null; source: string | null;
}
export interface PostReconciliation {
  id: number; title?: string | null; platform?: string | null; scheduledFor?: Date | string | null;
  publishedAt?: Date | string | null; postStatus?: string | null; contentStatus?: string | null; autoPost?: boolean | null;
  consigne?: string | null; campaignId?: number | null; body?: string | null; tendanceProjetId?: number | null;
}
export interface DepsReconciliation {
  conversationsATraiter(userId: string): Promise<ConversationATraiter[]>;
  appelsOffres(userId: string): Promise<AOReconciliation[]>;
  posts(userId: string, debut: Date, fin: Date): Promise<PostReconciliation[]>;
  /** Tâches NON faites et NON archivées : d'atelier (ou de validation) de ces semaines, ou liées à ces posts. */
  tachesDeProduction(userId: string, semaines: string[], postIds: number[]): Promise<{ semaine: string | null; contentId: number | null }[]>;
  /** Mails en attente dont la tâche n'existe plus (supprimée), mail depuis cet instant. */
  mailsSansTache(userId: string, depuis: Date): Promise<{ threadId: string; expediteur: string | null; sujet: string | null }[]>;
}

const CANAUX: Record<string, string> = { linkedin: "LinkedIn", email: "e-mail" };
const STATUTS_SANS_DECISION = new Set(["repere", "premier_jet_pret"]);

function reponses(convs: ConversationATraiter[]): Incoherence[] {
  const res: Incoherence[] = [];
  for (const c of convs) {
    const qui = c.nom?.trim() ? `Réponse de ${c.nom.trim()}` : "Réponse d'un prospect";
    const canal = CANAUX[c.canal] ?? c.canal;
    const lien = `/outreach?onglet=reponses&conversation=${c.id}`;
    const sansTache = !c.tache || !!c.tache.archivedAt;
    if (sansTache && c.dernierSens === "sortant") {
      res.push({ source: "reponses", libelle: `${qui} (${canal}) : marquée à traiter alors que tu as répondu`, lien });
    } else if (sansTache) res.push({ source: "reponses", libelle: `${qui} (${canal}) à traiter : aucune tâche pour s'en occuper`, lien });
    else if (c.tache!.completed && c.dernierSens !== "sortant") {
      res.push({ source: "reponses", libelle: `${qui} (${canal}) : tâche cochée, aucune réponse envoyée`, lien });
    }
  }
  return res;
}

function appelsOffres(lignes: AOReconciliation[], maintenant: Date): Incoherence[] {
  return lignes
    .filter((a) => a.scoreAdequation === "fort" && STATUTS_SANS_DECISION.has(a.statut)
      && !estPasse(a.dateLimite, maintenant) && !estEcarteParNaya(a))
    .sort((a, b) => (a.dateLimite ? new Date(a.dateLimite).getTime() : Infinity) - (b.dateLimite ? new Date(b.dateLimite).getTime() : Infinity) || a.id - b.id)
    .map((a) => ({
      source: "appels_offres",
      libelle: `Appel d'offres « ${a.objet.trim()} »${a.acheteur?.trim() ? ` (${a.acheteur.trim()})` : ""} : score fort, sans décision${a.dateLimite ? ` (date limite le ${jourLong(new Date(a.dateLimite))})` : ""}`,
      lien: "/appels-offres",
    }));
}

async function posts(userId: string, maintenant: Date, d: DepsReconciliation): Promise<Incoherence[]> {
  const debut = debutJourParis(maintenant);
  const fin = new Date(maintenant.getTime() + FENETRE_POSTS_JOURS * JOUR_MS);
  const aValider = (await d.posts(userId, debut, fin))
    .map((p) => ({ p, s: p.scheduledFor ? new Date(p.scheduledFor) : null }))
    .filter((x): x is { p: PostReconciliation; s: Date } => x.s != null && x.s.getTime() >= debut.getTime() && x.s.getTime() <= fin.getTime())
    .map((x) => ({ ...x, semaine: lundiDe(jourParis(x.s)) }))
    .filter((x) => { const e = etatPost(x.p); return e === "brouillon" || e === "a_rediger"; })
    .sort((a, b) => a.s.getTime() - b.s.getTime() || a.p.id - b.p.id);
  if (aValider.length === 0) return [];
  const semaines = [...new Set(aValider.map((x) => x.semaine))].sort();
  const ouvertes = await d.tachesDeProduction(userId, semaines, aValider.map((x) => x.p.id).sort((a, b) => a - b));
  const semainesCouvertes = new Set(ouvertes.map((t) => t.semaine).filter(Boolean));
  const postsCouverts = new Set(ouvertes.map((t) => t.contentId).filter((x) => x != null));
  return aValider
    .filter((x) => !semainesCouvertes.has(x.semaine) && !postsCouverts.has(x.p.id))
    .map((x) => ({
      source: "posts",
      libelle: `Post « ${(x.p.title ?? "").trim() || "Post sans titre"} » (${plateforme(x.p.platform)}, ${jourLong(x.s)}) à valider : aucune tâche d'atelier`,
      lien: lienAtelier(x.semaine),
    }));
}

async function mails(userId: string, maintenant: Date, d: DepsReconciliation): Promise<Incoherence[]> {
  const lignes = await d.mailsSansTache(userId, new Date(maintenant.getTime() - FENETRE_MAILS_JOURS * JOUR_MS));
  return lignes.map((m) => ({
    source: "mails",
    libelle: `${m.expediteur?.trim() ? `Mail de ${m.expediteur.trim()}` : "Mail d'un expéditeur inconnu"}${m.sujet?.trim() ? ` (« ${m.sujet.trim()} »)` : ""} : sa tâche « Répondre » a été supprimée`,
    // Aucune page de l'app ne montre un fil Gmail : le planning, où vivent les « Répondre à ».
    lien: "/planning",
  }));
}

/** Le lundi (Paris) seulement ; un autre jour, [] sans rien lire. Une source en panne n'efface pas les autres. */
export async function reconciliation(userId: string, maintenant: Date, deps?: DepsReconciliation): Promise<Incoherence[]> {
  if (jourDeSemaine(parisTodayString(maintenant)) !== LUNDI) return [];
  const d = deps ?? (await import("./cloture-deps")).depsReconciliation;
  const sources: [string, () => Promise<Incoherence[]>][] = [
    ["réponses", async () => reponses(await d.conversationsATraiter(userId))],
    ["appels d'offres", async () => appelsOffres(await d.appelsOffres(userId), maintenant)],
    ["posts", () => posts(userId, maintenant, d)],
    ["mails", () => mails(userId, maintenant, d)],
  ];
  const resultats = await Promise.all(sources.map(([nom, f]) => f().catch((e: any) => {
    console.error(`[fil] réconciliation (${nom}) user=${userId} :`, e?.message ?? e);
    return [] as Incoherence[];
  })));
  return resultats.flat();
}

// ── Caches du matin : 20 min par utilisatrice et par jour (Europe/Paris) ───────────────

export const CACHE_CLOTURE_MS = 20 * 60_000;
type Cache<T> = Map<string, { at: number; valeur: Promise<T> }>;
const cacheCloture: Cache<ATrancher[]> = new Map();
const cacheReconciliation: Cache<Incoherence[]> = new Map();

function enCache<T>(cache: Cache<T>, userId: string, maintenant: Date, calculer: () => Promise<T>): Promise<T> {
  const cle = `${userId}:${parisTodayString(maintenant)}`;
  const connu = cache.get(cle);
  if (connu && maintenant.getTime() - connu.at < CACHE_CLOTURE_MS) return connu.valeur;
  cache.forEach((v, k) => { if (maintenant.getTime() - v.at >= CACHE_CLOTURE_MS) cache.delete(k); });
  const valeur = calculer();
  cache.set(cle, { at: maintenant.getTime(), valeur });
  // Un échec n'est pas gardé : le prochain matin réessaie.
  valeur.catch(() => { if (cache.get(cle)?.valeur === valeur) cache.delete(cle); });
  return valeur;
}

export function clotureEnCache(
  userId: string, maintenant: Date,
  calculer: (userId: string, maintenant: Date) => Promise<ATrancher[]> = clotureDuVendredi,
): Promise<ATrancher[]> {
  return enCache(cacheCloture, userId, maintenant, () => calculer(userId, maintenant));
}

export function reconciliationEnCache(
  userId: string, maintenant: Date,
  calculer: (userId: string, maintenant: Date) => Promise<Incoherence[]> = reconciliation,
): Promise<Incoherence[]> {
  return enCache(cacheReconciliation, userId, maintenant, () => calculer(userId, maintenant));
}

/** Après un geste de Jeanne : la liste du vendredi se relit au prochain matin. */
export function oublierClotureDe(userId: string): void {
  cacheCloture.forEach((_v, k) => { if (k.startsWith(`${userId}:`)) cacheCloture.delete(k); });
}

/** Pour les tests. */
export function viderCachesCloture(): void {
  cacheCloture.clear();
  cacheReconciliation.clear();
}
