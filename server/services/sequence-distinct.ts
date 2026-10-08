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

function motsPorteurs(t: string): string[] {
  return t.split(" ").filter((w) => w.length >= 3);
}

function trigrammes(mots: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < mots.length; i++) out.add(`${mots[i]} ${mots[i + 1]} ${mots[i + 2]}`);
  return out;
}

/**
 * Deux textes adressés au même prospect sont-ils trop proches pour partir tous les deux ?
 * Après normalisation (`normaliserTexte`) :
 *  - identiques                                                   → oui ;
 *  - l'un contient l'autre (≥ 4 mots)                             → oui ;
 *  - Jaccard des ensembles de mots porteurs ≥ SEUIL_JACCARD_MOTS (0,55)
 *    (même vocabulaire réordonné = paraphrase)                     → oui ;
 *  - ≥ SEUIL_INCLUSION_TRIGRAMMES (50 %) des trigrammes de mots du plus court se
 *    retrouvent dans le plus long (la note d'invitation recopiée dans le message) → oui.
 * Un texte vide n'est jamais « proche ».
 */
export function tropProche(a: string, b: string): boolean {
  const na = normaliserTexte(a);
  const nb = normaliserTexte(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [court, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (court.split(" ").length >= 4 && long.includes(court)) return true;

  const ma = motsPorteurs(na);
  const mb = motsPorteurs(nb);
  const sa = new Set(ma);
  const sb = new Set(mb);
  if (sa.size > 0 && sb.size > 0) {
    let inter = 0;
    sa.forEach((w) => { if (sb.has(w)) inter++; });
    const jaccard = inter / (sa.size + sb.size - inter);
    if (jaccard >= SEUIL_JACCARD_MOTS) return true;
  }

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

/** Premier texte antérieur trop proche de `texte`, ou null. */
export function premierConflit(texte: string, anterieurs: string[]): string | null {
  for (const t of anterieurs) if (tropProche(texte, t)) return t;
  return null;
}
