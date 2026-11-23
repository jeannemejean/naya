// Fiabilité de la publication automatique (23 nov. 2026). Module pur : décider s'il faut
// réessayer, quand, et dire en clair ce qui s'est passé. Aucun changement de schéma : le
// réessai prévu est porté par `lastError` (« reessai:N@<instant>|<erreur> »), et l'heure de
// publication affichée (`scheduledFor`) ne bouge pas.

export const MAX_TENTATIVES = 3;
/** Délais avant chaque réessai, en minutes : tout tient dans la marge de 120 min du worker. */
export const DELAIS_MIN = [5, 15, 45] as const;
/** Au-delà, un post resté « en cours de publication » est considéré bloqué (redémarrage, plantage). */
export const DELAI_BLOQUE_MIN = 15;

const TRANSITOIRE = /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|timeout|\b5\d\d\b|\b429\b|rate.?limit|too many requests|temporarily|try again/i;
const RE_REESSAI = /^reessai:(\d+)@([^|]+)\|([\s\S]*)$/;

export const estTransitoire = (erreur: string) => TRANSITOIRE.test(erreur);

function lireReessai(lastError: string | null | undefined): { n: number; quand: Date; erreur: string } | null {
  const m = RE_REESSAI.exec(lastError ?? "");
  if (!m) return null;
  const quand = new Date(m[2]);
  return Number.isNaN(quand.getTime()) ? null : { n: Number(m[1]), quand, erreur: m[3] };
}

/** Après un échec : réessayer plus tard (transitoire, tentatives restantes) ou échec définitif. */
export function apresEchec(erreur: string, lastError: string | null | undefined, maintenant: Date):
  { etat: "reessai" | "echec"; lastError: string } {
  const msg = erreur.slice(0, 280);
  const deja = lireReessai(lastError)?.n ?? 0;
  if (!estTransitoire(msg) || deja >= MAX_TENTATIVES) return { etat: "echec", lastError: msg };
  const quand = new Date(maintenant.getTime() + DELAIS_MIN[deja] * 60_000);
  return { etat: "reessai", lastError: `reessai:${deja + 1}@${quand.toISOString()}|${msg}` };
}

/** Un post en attente de réessai n'est repris qu'à l'heure prévue. */
export function reessaiDu(lastError: string | null | undefined, maintenant: Date): boolean {
  const r = lireReessai(lastError);
  return !r || r.quand.getTime() <= maintenant.getTime();
}

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
  publication_a_verifier: "La publication a été interrompue : vérifie sur le réseau si le post est parti avant de le republier.",
};

/** Ce que voit l'utilisatrice : la raison en clair, sans le préfixe technique du réessai. */
export function raisonLisible(lastError: string | null | undefined): string {
  const brut = lireReessai(lastError)?.erreur ?? (lastError ?? "");
  return RAISONS[brut] ?? brut;
}
