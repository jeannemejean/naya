// Fiabilité de la publication automatique (23 nov. 2026). Module pur : décider quoi faire
// d'un échec, et dire en clair ce qui s'est passé. Aucun changement de schéma : le réessai
// prévu est porté par `lastError` (« reessai:N@<instant>|<erreur> »), et l'heure de
// publication affichée (`scheduledFor`) ne bouge pas.
//
// Règle d'or : JAMAIS de double publication. Les appels finaux (media_publish d'Instagram,
// /posts de LinkedIn, /feed de Facebook) ne sont pas idempotents : une coupure réseau, un délai
// dépassé ou une erreur 5xx peuvent arriver APRÈS que le réseau a publié. Ces cas-là ne sont
// jamais réessayés : ils deviennent « à vérifier ». Seul un refus explicite du réseau (limite de
// débit, média pas encore prêt) est réessayé : rien n'est parti.

export const MAX_TENTATIVES = 3;
/** Délais avant chaque réessai, en minutes. */
export const DELAIS_MIN = [5, 15, 45] as const;
/** Au-delà, un post resté « en cours de publication » est considéré bloqué (redémarrage, plantage). */
export const DELAI_BLOQUE_MIN = 15;

// Formats réels des publieurs : « ig_429: … », « graph_429: … », « li_post_429: … », messages Meta
// « (#4) Application request limit reached », « (#9007) Media ID is not available ».
const REFUS_SUR = /(?:^|[_\s])429\b|too many requests|rate.?limit|request limit|\(#(?:4|17|32|613|9007)\)|#9007|media id is not available/i;
// Peut avoir publié : coupure, délai dépassé, erreur serveur (« ig_500: », « li_post_503: »…).
const INCERTAIN = /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|timed? ?out|aborted|(?:^|[_\s])5\d\d\s*:/i;
const RE_REESSAI = /^reessai:(\d+)@([^|]+)\|([\s\S]*)$/;
const PREFIXE_VERIFIER = "a_verifier|";

export type Nature = "refus_sur" | "incertain" | "definitif";
export function natureErreur(erreur: string): Nature {
  if (REFUS_SUR.test(erreur)) return "refus_sur";
  if (INCERTAIN.test(erreur)) return "incertain";
  return "definitif";
}

function lireReessai(lastError: string | null | undefined): { n: number; quand: Date; erreur: string } | null {
  const m = RE_REESSAI.exec(lastError ?? "");
  if (!m) return null;
  const quand = new Date(m[2]);
  return Number.isNaN(quand.getTime()) ? null : { n: Number(m[1]), quand, erreur: m[3] };
}

/**
 * Après un échec :
 *  - refus sûr et tentatives restantes → réessai plus tard ;
 *  - incertain (le post a pu partir) → échec « à vérifier », jamais republié seul ;
 *  - sinon → échec définitif.
 */
export function apresEchec(erreur: string, lastError: string | null | undefined, maintenant: Date):
  { etat: "reessai" | "echec"; lastError: string } {
  const msg = erreur.slice(0, 280);
  const nature = natureErreur(msg);
  if (nature === "incertain") return { etat: "echec", lastError: `${PREFIXE_VERIFIER}${msg}` };
  const deja = lireReessai(lastError)?.n ?? 0;
  if (nature === "definitif" || deja >= MAX_TENTATIVES) return { etat: "echec", lastError: msg };
  const quand = new Date(maintenant.getTime() + DELAIS_MIN[deja] * 60_000);
  return { etat: "reessai", lastError: `reessai:${deja + 1}@${quand.toISOString()}|${msg}` };
}

/** Un post en attente de réessai n'est repris qu'à l'heure prévue. */
export function reessaiDu(lastError: string | null | undefined, maintenant: Date): boolean {
  const r = lireReessai(lastError);
  return !r || r.quand.getTime() <= maintenant.getTime();
}

/** L'erreur portée par un réessai prévu (pour le rattrapage), ou null. */
export const erreurDuReessai = (lastError: string | null | undefined) => lireReessai(lastError)?.erreur ?? null;

export function estBloque(p: { postStatus?: string | null; updatedAt?: Date | string | null }, maintenant: Date): boolean {
  if (p.postStatus !== "posting" || !p.updatedAt) return false;
  return maintenant.getTime() - new Date(p.updatedAt).getTime() > DELAI_BLOQUE_MIN * 60_000;
}

const RAISONS: Record<string, string> = {
  compte_expire: "La connexion au compte a expiré : reconnecte-le dans Réglages, puis reprogramme le post.",
  compte_absent: "Aucun compte connecté pour ce réseau.",
  compte_supprime: "Le compte a été déconnecté.",
  media_required: "Ce réseau demande un visuel, le post n'en a pas.",
  plateforme_non_supportee: "Naya ne publie pas encore seule sur ce réseau : publie-le toi-même.",
  publication_manquee: "Le post n'a pas pu partir à l'heure (Naya était indisponible). Publie-le toi-même ou reprogramme-le.",
  li_document_image_non_supportee: "Le carrousel PDF LinkedIn n'accepte que des images JPEG ou PNG : remplace les autres visuels, ou publie-le en images.",
  publication_a_verifier: "La publication a été interrompue : vérifie sur le réseau si le post est parti avant de le republier.",
};

/** Ce que voit l'utilisatrice : la raison en clair, sans préfixe technique. */
export function raisonLisible(lastError: string | null | undefined): string {
  let brut = lireReessai(lastError)?.erreur ?? (lastError ?? "");
  if (brut.startsWith(PREFIXE_VERIFIER)) {
    return `Le réseau n'a pas répondu à temps : le post est peut-être parti. Vérifie sur le réseau avant de le republier. (${brut.slice(PREFIXE_VERIFIER.length)})`;
  }
  return RAISONS[brut] ?? brut;
}
