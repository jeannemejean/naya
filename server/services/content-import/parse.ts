// Découpage d'un texte libre — typiquement un calendrier de contenu écrit ailleurs — en
// posts du calendrier éditorial.
//
// TOUT CE FICHIER EST PUR : aucun accès base, aucun appel modèle. Ce qui juge est ici
// et se teste sans infrastructure ; l'orchestration est dans `import.ts` et ne décide
// rien.

/** Longueur maximale d'un texte collé. Au-delà, l'import refuse en nommant la limite. */
export const MAX_CARACTERES = 40000;

/** Bornes de plausibilité d'une date rendue par le modèle, en jours autour d'aujourd'hui. */
const JOURS_PASSE_TOLERES = 365;
const JOURS_FUTUR_TOLERES = 730;

/** Longueur maximale d'un titre conservé, alignée sur `brand-links/collision.ts`. */
const LONGUEUR_MAX_TITRE = 200;

/**
 * Un post tel que le MODÈLE le rend. Chaque champ optionnel vaut `null` quand le texte
 * ne le dit pas — le modèle ne devine pas et ne déclare pas ses déductions.
 */
export interface PostExtrait {
  titre: string;
  corps: string;
  plateforme: string | null;
  type: string | null;
  pilier: string | null;
  objectif: string | null;
  date: string | null;
}

export const PROMPT_EXTRACTION = `Tu reçois un texte écrit par une créatrice de contenu : le plus souvent un calendrier de contenu, une liste d'idées de posts, ou un mélange des deux.

Ta tâche : EXTRAIRE les posts qu'il contient. Tu n'écris rien de nouveau, tu ne réécris pas, tu ne reformules pas. Le corps de chaque post est le texte de la créatrice, recopié.

Réponds UNIQUEMENT par un tableau JSON, sans texte autour :
[{"titre": "...", "corps": "...", "plateforme": null, "type": null, "pilier": null, "objectif": null, "date": null}]

Pour chaque champ autre que "titre" et "corps" : si le texte ne le dit pas, mets null. N'invente JAMAIS une valeur plausible — null est la bonne réponse quand tu ne sais pas, et elle est attendue.

- "plateforme" : seulement si le texte la nomme (linkedin, instagram, tiktok, facebook, youtube, newsletter...).
- "type" : seulement si le texte le nomme (post, carousel, reel, story, article, video...).
- "pilier" : le thème éditorial, seulement si le texte l'identifie comme tel.
- "objectif" : seulement si le texte le dit.
- "date" : au format AAAA-MM-JJ, et SEULEMENT si le texte désigne un jour précis que tu peux résoudre sans ambiguïté. « Semaine du 12 » ne désigne pas un jour : mets null. Un jour sans mois ni année que rien ne permet de situer : null.

Si le texte ne contient aucun post identifiable, réponds [].`;

/** Le message utilisateur : le texte collé, ancré par la date du jour. */
export function construireMessageExtraction(texte: string, aujourdhui: Date): string {
  const annee = aujourdhui.getFullYear();
  const mois = String(aujourdhui.getMonth() + 1).padStart(2, "0");
  const jour = String(aujourdhui.getDate()).padStart(2, "0");
  const dateStr = `${annee}-${mois}-${jour}`;
  return `Nous sommes le ${dateStr}. Les dates que tu résous se rapportent à cette date.\n\nTEXTE À DÉCOUPER\n${texte}`;
}

/**
 * Lit la sortie du modèle. Pure. Tolère du bavardage autour du tableau JSON, et écarte
 * les entrées sans titre ou sans corps — un post sans corps n'est pas un post.
 *
 * `null` (réponse illisible) et `[]` (le modèle n'a rien trouvé) sont DEUX réponses
 * différentes : la première est une panne, la seconde est un résultat.
 */
export function parsePostsExtraits(raw: string): PostExtrait[] | null {
  if (!raw) return null;
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return null;
  let brut: unknown;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  if (!Array.isArray(brut)) return null;

  const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const posts: PostExtrait[] = [];
  for (const item of brut) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const titre = texte(o.titre);
    const corps = texte(o.corps);
    if (!titre || !corps) continue;
    posts.push({
      titre: titre.slice(0, LONGUEUR_MAX_TITRE),
      corps,
      plateforme: texte(o.plateforme),
      type: texte(o.type),
      pilier: texte(o.pilier),
      objectif: texte(o.objectif),
      date: texte(o.date),
    });
  }
  return posts;
}

/**
 * Valide la date rendue par le modèle. C'est LUI qui résout (il a la date du jour) ;
 * c'est NOUS qui vérifions — un modèle qui se trompe sur une date doit produire une
 * absence de date, jamais une date fausse.
 *
 * Trois filtres : la forme, l'existence réelle du jour (2026-02-30 n'existe pas), et la
 * plausibilité (un 1970 ou un 2199 est une hallucination, pas une intention).
 */
export function resoudreDate(brut: string | null, aujourdhui: Date): Date | null {
  if (!brut || !/^\d{4}-\d{2}-\d{2}$/.test(brut)) return null;
  const [annee, mois, jour] = brut.split("-").map(Number);
  const d = new Date(annee, mois - 1, jour);
  // Un mois ou un jour hors bornes se « reporte » silencieusement en JavaScript
  // (2026-02-30 devient le 2 mars) : on recompare les composants OBTENUS à ceux reçus
  // pour rejeter ce report au lieu de l'accepter comme une date valide.
  //
  // La comparaison se fait sur les composants LOCAUX, jamais via `toISOString()` :
  // vérifié, à Paris (UTC+2) `new Date("2026-10-06T00:00:00").toISOString()` rend
  // "2026-10-05" — un garde écrit sur l'ISO rejetterait TOUTES les dates valides du
  // fuseau. Le minuit local est aussi ce que veut `scheduledFor`, et c'est le motif
  // déjà utilisé dans `server/routes.ts` pour les dates de campagne.
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) return null;
  const minimum = aujourdhui.getTime() - JOURS_PASSE_TOLERES * 86400000;
  const maximum = aujourdhui.getTime() + JOURS_FUTUR_TOLERES * 86400000;
  if (d.getTime() < minimum || d.getTime() > maximum) return null;
  return d;
}

/**
 * Rapport entre la longueur du texte REPRIS et celle du texte collé.
 *
 * C'est la contrepartie de l'absence de validation : un découpage qui rate quatre posts
 * sur dix-huit ne produit AUCUNE erreur, seulement un résultat appauvri. Cette mesure
 * est la seule chose qui le rend visible.
 *
 * Le numérateur ne compte QUE les corps, jamais les titres : le titre n'existe presque
 * jamais tel quel dans le texte collé, le modèle le SYNTHÉTISE (voir le prompt
 * d'extraction, qui ne demande pas de recopier un titre). L'additionner au corps gonfle
 * artificiellement la couverture — vérifié contre le vrai modèle : une extraction fidèle
 * de dix posts sur dix donnait un rapport de 1,085 avec titre+corps, borné à 100 % à
 * l'affichage, donc indiscernable d'une réécriture complète (rapport 1,4). Le corps,
 * lui, est ce que le prompt demande de recopier mot pour mot : c'est lui, et seulement
 * lui, qui mesure la fidélité de l'extraction.
 *
 * Peut dépasser 1 : cela signifie que le modèle a réécrit au lieu d'extraire, ce que
 * l'appelant journalise.
 */
export function mesurerCouverture(posts: PostExtrait[], texte: string): number {
  const longueur = texte.length;
  if (longueur === 0) return 0;
  const extrait = posts.reduce((n, p) => n + p.corps.length, 0);
  return extrait / longueur;
}

/** Plateforme retenue quand la marque n'a aucun contenu, ou en cas d'égalité. */
export const PLATEFORME_PAR_DEFAUT = "linkedin";

/**
 * La plateforme la plus fréquente d'une liste. Pure.
 *
 * Le départage d'une égalité se fait par ordre alphabétique, donc de façon
 * DÉTERMINISTE : sans lui, deux imports du même texte sur la même marque pourraient
 * combler la plateforme différemment selon l'ordre physique des lignes rendues par
 * Postgres.
 *
 * Calculée ici, en pur, plutôt que par un `GROUP BY` : ce dépôt n'utilise `groupBy`
 * nulle part, et le mock de base de référence ne le capture pas — l'introduire pour
 * une seule requête obligerait à étendre l'échafaudage de test de tout le dépôt.
 */
export function plateformeMajoritaire(plateformes: string[]): string {
  const comptes = new Map<string, number>();
  for (const p of plateformes) {
    if (!p) continue;
    comptes.set(p, (comptes.get(p) ?? 0) + 1);
  }
  if (comptes.size === 0) return PLATEFORME_PAR_DEFAUT;
  return [...comptes.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0][0];
}

export interface ChampsCombles {
  valeurs: { platform: string; contentType: string; pillar: string; goal: string };
  /** Les champs que LE SERVEUR a comblés, pour `content.deducedFields`. */
  deduits: string[];
}

/**
 * Comble les champs obligatoires que le texte ne donnait pas, et rend la liste de ceux
 * qu'il a fallu combler.
 *
 * Le pilier et l'objectif restent VIDES et n'entrent PAS dans `deduits` : une chaîne
 * vide n'est pas une déduction, c'est une absence assumée. Vérifié dans l'interface :
 * un pilier vide ne s'affiche pas (`content-calendar.tsx:900`) et n'empêche pas
 * l'enregistrement — la seule exigence de non-vide porte sur le bouton de génération
 * assistée (`:758`).
 */
export function comblerChamps(post: PostExtrait, plateformeParDefaut: string): ChampsCombles {
  const deduits: string[] = [];
  let platform = post.plateforme;
  if (!platform) { platform = plateformeParDefaut; deduits.push("platform"); }
  let contentType = post.type;
  if (!contentType) { contentType = "post"; deduits.push("contentType"); }
  return {
    valeurs: { platform, contentType, pillar: post.pilier ?? "", goal: post.objectif ?? "" },
    deduits,
  };
}
