// Rejet d'une campagne générée.
//
// Cette partie du fichier est PURE : aucun accès base, aucun appel modèle. Ce qui
// DÉCIDE quoi garder est ici et se teste sans infrastructure ; l'orchestration est en
// bas et ne décide rien.

/** Salience d'un rejet. Le défaut de la colonne est 0,5 ; un rejet explicitement
 *  formulé par l'utilisatrice est un signal plus fort qu'une observation déduite. */
export const SALIENCE_REJET = 0.8;

export interface ContenuCandidat {
  id: number;
  publishedAt: Date | null;
  postStatus: string | null;
  contentStatus: string | null;
}

export interface TacheCandidate {
  id: number;
  completed: boolean;
}

export interface Tri {
  /** Identifiants à DÉTACHER (campaignId → null) : ils survivent au rejet. */
  gardes: number[];
  /** Identifiants à supprimer avec la campagne. */
  partants: number[];
}

/**
 * Un contenu est considéré comme publié dès qu'UN SEUL signal est allumé.
 *
 * `content` porte quatre champs qui peuvent se contredire : une carte glissée en
 * « publié » dans le pipeline n'est pas forcément partie sur une plateforme, et un post
 * auto-publié n'a pas forcément vu son `contentStatus` suivre. On ne cherche pas à
 * arbitrer entre eux : on garde dès que l'un dit « publié ».
 *
 * Le sens prudent est le bon, et il est assumé : garder quelque chose en trop coûte de
 * l'encombrement ; supprimer quelque chose de publié falsifie l'historique de
 * l'utilisatrice.
 */
export function contenuEstPublie(c: ContenuCandidat): boolean {
  if (c.publishedAt !== null && c.publishedAt !== undefined) return true;
  if ((c.postStatus || "").trim().toLowerCase() === "posted") return true;
  if ((c.contentStatus || "").trim().toLowerCase() === "published") return true;
  return false;
}

export function tacheEstFaite(t: TacheCandidate): boolean {
  return t.completed === true;
}

export function trierContenus(cs: ContenuCandidat[]): Tri {
  const gardes: number[] = [];
  const partants: number[] = [];
  for (const c of cs) (contenuEstPublie(c) ? gardes : partants).push(c.id);
  return { gardes, partants };
}

export function trierTaches(ts: TacheCandidate[]): Tri {
  const gardes: number[] = [];
  const partants: number[] = [];
  for (const t of ts) (tacheEstFaite(t) ? gardes : partants).push(t.id);
  return { gardes, partants };
}

/**
 * Le texte de la préférence déposée en mémoire.
 *
 * Elle doit se tenir SEULE : une entrée de mémoire est relue des mois plus tard, mêlée
 * à d'autres, hors de tout contexte. « Je ne veux pas ça » y serait illisible — d'où le
 * rappel de ce qui a été rejeté, et pas seulement de la raison.
 *
 * Rend `null` quand la raison est vide : pas de préférence sans raison (Décision 4 du
 * spec). C'est l'appelant qui en informe l'utilisatrice.
 */
export function construirePreference(input: {
  campagne: { name: string | null; objective: string | null; coreMessage: string | null };
  raison: string;
}): string | null {
  const raison = (input.raison || "").trim();
  if (!raison) return null;

  const { name, objective, coreMessage } = input.campagne;
  const nom = (name || "").trim();
  const lignes: string[] = [
    nom
      ? `Campagne rejetée pour cette marque : « ${nom} ».`
      : "Une campagne générée pour cette marque a été rejetée.",
  ];
  const obj = (objective || "").trim();
  if (obj) lignes.push(`Son objectif était : ${obj}.`);
  const msg = (coreMessage || "").trim();
  if (msg) lignes.push(`Son message central était : ${msg}.`);
  const raisonAvecPoint = raison.endsWith(".") ? raison : raison + ".";
  lignes.push(`Ce qui n'allait pas, dans les mots de l'utilisatrice : ${raisonAvecPoint}`);
  return lignes.join(" ");
}
