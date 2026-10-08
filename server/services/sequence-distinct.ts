/**
 * Règles PURES qui garantissent que les messages d'une séquence restent distincts :
 *  - `roleEtapeLinkedin` : le rôle réel d'une étape LinkedIn (note d'invitation,
 *    message après acceptation, relance), déduit de la structure de la séquence ;
 *  - `tropProche` : garde anti-doublon entre deux textes adressés au même prospect.
 *
 * Aucune dépendance (DB, IA) : testées isolément dans sequence-distinct.test.ts.
 */

export type RoleEtapeLinkedin = "invitation" | "message_apres_acceptation" | "relance";

export interface EtapeLike {
  channel: string;
  condition?: string | null;
  intention?: string | null;
}

/**
 * Indice explicite d'invitation dans l'intention (FR/EN), après normalisation.
 * Un texte qui parle de l'APRÈS (« message après connexion », « after the invite is
 * accepted ») n'est PAS une invitation : il est exclu.
 */
export function intentionDitInvitation(intention?: string | null): boolean {
  const t = normaliserTexte(intention || "");
  if (!t) return false;
  if (/\b(apres|after|suite|accept\w*|une fois)\b/.test(t)) return false;
  return /\b(invitation|invitations|invite|inviter|connexion|connection|connect|se connecter|demande de mise en relation)\b/.test(t);
}

/**
 * Rôle d'une étape LinkedIn dans la séquence. `null` pour une étape email (inchangée).
 *
 * Ordre de priorité (le premier qui s'applique gagne) :
 *  1. condition `if_invite_accepted`                       → message_apres_acceptation
 *     (la structure prime toujours sur le texte libre de l'intention).
 *  2. aucune étape LinkedIn AVANT celle-ci (première touche LinkedIn du prospect)
 *     → invitation. Quelle que soit sa condition (always, if_invite_not_accepted, ou
 *     une condition email comme if_opened) : sans connexion préalable, sendLinkedInStep
 *     enverra une invitation avec ce texte comme note.
 *  3. l'intention dit EXPLICITEMENT invitation/invite/connexion (FR/EN, voir
 *     `intentionDitInvitation`) ET aucune étape LinkedIn antérieure n'a déjà le rôle
 *     invitation                                            → invitation.
 *  4. sinon                                                 → relance.
 * L'intention n'est donc qu'un indice : elle ne peut que désigner l'invitation quand la
 * structure n'en a pas déjà une, jamais contredire une condition `if_invite_accepted`.
 */
export function roleEtapeLinkedin(steps: EtapeLike[], index: number): RoleEtapeLinkedin | null {
  const step = steps[index];
  if (!step || step.channel !== "linkedin") return null;
  if (step.condition === "if_invite_accepted") return "message_apres_acceptation";
  const anterieuresLi: number[] = [];
  for (let i = 0; i < index; i++) if (steps[i]?.channel === "linkedin") anterieuresLi.push(i);
  if (anterieuresLi.length === 0) return "invitation";
  if (intentionDitInvitation(step.intention)) {
    const dejaInvitation = anterieuresLi.some((i) => roleEtapeLinkedin(steps, i) === "invitation");
    if (!dejaInvitation) return "invitation";
  }
  return "relance";
}

/** Minuscules, accents retirés, ponctuation retirée, espaces normalisés. */
export function normaliserTexte(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Seuil de Jaccard sur les mots porteurs (≥ 3 lettres) au-delà duquel deux textes sont « trop proches ». */
export const SEUIL_JACCARD_MOTS = 0.55;
/** Part des trigrammes de mots du texte le plus court retrouvés dans l'autre (reprise/citation). */
export const SEUIL_INCLUSION_TRIGRAMMES = 0.5;
/**
 * En dessous de ce nombre de mots porteurs (après retrait des mots neutres), un texte est
 * trop court pour qu'un recouvrement de vocabulaire veuille dire « paraphrase » : on ne
 * signale alors que l'égalité quasi exacte.
 */
export const MIN_MOTS_PORTEURS = 6;

/**
 * Formules de salutation / politesse retirées des DEUX textes avant comparaison (en
 * expressions entières, jamais mot à mot : « bien à vous » ne doit pas retirer « vous »
 * partout). Elles sont communes à tous les messages et ne disent rien de leur fond.
 */
export const FORMULES_NEUTRES = [
  "bonjour", "bonsoir", "hello", "salut", "hi", "coucou",
  "merci beaucoup", "merci", "belle journee", "bonne journee", "belle soiree", "bonne soiree",
  "bonne semaine", "belle semaine", "a bientot", "a tres vite", "au plaisir", "cordialement",
  "bien a vous", "bien a toi", "bien cordialement", "best regards", "regards", "thanks", "thank you",
];

export interface ContexteComparaison {
  /**
   * Noms propres communs à tous les messages pour CE prospect : prénom/nom/nom complet du
   * prospect, nom de son entreprise, sa ville, prénom/nom de l'expéditrice. Retirés en
   * expression entière ET mot à mot (« Lumen Concept Store » retire aussi « concept »).
   */
  neutres?: string[];
}

function motsPorteurs(t: string): string[] {
  return t.split(" ").filter((w) => w.length >= 3);
}

function trigrammes(mots: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < mots.length; i++) out.add(`${mots[i]} ${mots[i + 1]} ${mots[i + 2]}`);
  return out;
}

function retirerExpression(t: string, expr: string): string {
  if (!expr) return t;
  return ` ${t} `.split(` ${expr} `).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Texte normalisé, débarrassé des formules neutres et des noms propres du contexte.
 * Pure, exportée pour les tests.
 */
export function texteSignifiant(s: string, ctx?: ContexteComparaison): string {
  let t = normaliserTexte(s);
  const expressions = (ctx?.neutres || []).map(normaliserTexte).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const e of expressions) t = retirerExpression(t, e);
  const motsNeutres = new Set(expressions.flatMap((e) => e.split(" ")).filter((w) => w.length >= 2));
  if (motsNeutres.size) t = t.split(" ").filter((w) => !motsNeutres.has(w)).join(" ");
  for (const f of FORMULES_NEUTRES) t = retirerExpression(t, f);
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Deux textes adressés au même prospect sont-ils trop proches pour partir tous les deux ?
 * Comparaison faite sur `texteSignifiant` (normalisé, sans formules de politesse ni noms
 * propres du contexte : nom du prospect, entreprise, ville, expéditrice), sinon deux
 * messages courts différents se ressemblent par leurs seuls noms propres.
 *  - textes signifiants identiques (ou textes bruts identiques)       → oui ;
 *  - si l'un des deux a moins de MIN_MOTS_PORTEURS (6) mots porteurs : rien d'autre
 *    (trop court pour juger une paraphrase) → non ;
 *  - l'un contient l'autre (≥ 4 mots)                                  → oui ;
 *  - Jaccard des ensembles de mots porteurs ≥ SEUIL_JACCARD_MOTS (0,55) → oui ;
 *  - ≥ SEUIL_INCLUSION_TRIGRAMMES (50 %) des trigrammes du plus court
 *    retrouvés dans le plus long (note d'invitation recopiée)          → oui.
 * Un texte vide n'est jamais « proche ».
 */
export function tropProche(a: string, b: string, ctx?: ContexteComparaison): boolean {
  const ra = normaliserTexte(a);
  const rb = normaliserTexte(b);
  if (!ra || !rb) return false;
  if (ra === rb) return true;
  const na = texteSignifiant(a, ctx);
  const nb = texteSignifiant(b, ctx);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ma = motsPorteurs(na);
  const mb = motsPorteurs(nb);
  if (ma.length < MIN_MOTS_PORTEURS || mb.length < MIN_MOTS_PORTEURS) return false;

  const [court, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (court.split(" ").length >= 4 && ` ${long} `.includes(` ${court} `)) return true;

  const sa = new Set(ma);
  const sb = new Set(mb);
  let inter = 0;
  sa.forEach((w) => { if (sb.has(w)) inter++; });
  if (inter / (sa.size + sb.size - inter) >= SEUIL_JACCARD_MOTS) return true;

  const ta = trigrammes(na.split(" "));
  const tb = trigrammes(nb.split(" "));
  const [tc, tl] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (tc.size >= 3) {
    let communs = 0;
    tc.forEach((g) => { if (tl.has(g)) communs++; });
    if (communs / tc.size >= SEUIL_INCLUSION_TRIGRAMMES) return true;
  }
  return false;
}

/**
 * Deux conditions qui ne peuvent JAMAIS être vraies pour le même prospect : le texte
 * d'une branche ne partira jamais si l'autre part, inutile de s'en distinguer.
 * Volontairement limité aux paires opposées (un clic implique une ouverture) ; les cas
 * indécidables statiquement (if_opened vs if_clicked, branches imbriquées sur plusieurs
 * canaux) restent comparés,
 * ce qui ne peut produire qu'un excès de prudence, jamais un doublon envoyé.
 */
export function branchesExclusives(a?: string | null, b?: string | null): boolean {
  const paire = new Set([a || "always", b || "always"]);
  return (paire.has("if_invite_accepted") && paire.has("if_invite_not_accepted"))
    || (paire.has("if_opened") && paire.has("if_not_opened"))
    || (paire.has("if_clicked") && paire.has("if_not_opened"));
}

/** Premier texte antérieur trop proche de `texte`, ou null. */
export function premierConflit(texte: string, anterieurs: string[], ctx?: ContexteComparaison): string | null {
  for (const t of anterieurs) if (tropProche(texte, t, ctx)) return t;
  return null;
}

/** Raison affichée à l'utilisatrice quand Naya renonce à une étape (voir prospection-sender). */
export const RAISON_TROP_PROCHE =
  "Naya n'arrive pas à écrire un message assez différent du précédent — à rédiger à la main.";

/** Nombre de blocages « trop proche » CONSÉCUTIFS au-delà duquel le moteur renonce. */
export const MAX_TROP_PROCHE_CONSECUTIFS = 3;

export interface TropProcheOutcome {
  abandon: boolean;
  consecutifs: number;
  /** `null` quand `abandon` : l'étape n'est plus retentée automatiquement. */
  nextRunAt: Date | null;
}

/** Suite d'un blocage « trop proche » pour UN prospect. Pure : `now` en paramètre. */
export function nextTropProcheState(precedents: number, now: Date, backoffMs: number): TropProcheOutcome {
  const consecutifs = Math.max(0, precedents || 0) + 1;
  if (consecutifs >= MAX_TROP_PROCHE_CONSECUTIFS) return { abandon: true, consecutifs, nextRunAt: null };
  return { abandon: false, consecutifs, nextRunAt: new Date(now.getTime() + backoffMs) };
}

/**
 * État de la garde, rangé dans `leads.enriched_profile.nayaSequence` (jsonb existant,
 * aucune migration). Effacé à chaque envoi réussi et à chaque (ré)enrôlement ; aussi
 * remplacé si un ré-enrichissement réécrit tout `enriched_profile`.
 */
export interface LeadSequenceGuard {
  tropProcheConsecutifs: number;
  /** Étape (id) bloquée en dernier. */
  stepId: number | null;
  /** Raison visible quand le moteur a renoncé (RAISON_TROP_PROCHE), sinon null. */
  attention: string | null;
}

/** Lit la garde depuis une ligne lead (tolérant : absente/malformée → null). */
export function lireGarde(lead: any): LeadSequenceGuard | null {
  const g = lead?.enrichedProfile?.nayaSequence;
  if (!g || typeof g !== "object") return null;
  return {
    tropProcheConsecutifs: Number(g.tropProcheConsecutifs) || 0,
    stepId: typeof g.stepId === "number" ? g.stepId : null,
    attention: typeof g.attention === "string" && g.attention ? g.attention : null,
  };
}

/**
 * Ce que l'aperçu doit montrer de la garde : la raison (si le moteur a renoncé) et l'index
 * de l'étape bloquée dans la liste affichée (-1 si absente). Pure.
 */
export function etatGardeApercu(lead: any, stepIds: number[]): { attention: string | null; indexBloque: number } {
  const g = lireGarde(lead);
  if (!g?.attention) return { attention: null, indexBloque: -1 };
  return { attention: g.attention, indexBloque: g.stepId == null ? -1 : stepIds.indexOf(g.stepId) };
}
