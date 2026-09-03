/**
 * LA frontière « non mesuré » / « mesuré à zéro » du crédit d'attribution (finding C1 de la
 * revue finale du LOT 3B).
 *
 * `receivedVsIntentScore` (voir score.ts) porte deux canaux DISTINCTS sur
 * `conversionsInWindow` : `null` = NON MESURÉ (exclu du calcul, la confiance en paie le
 * prix, jamais le score) ; un nombre = MESURÉ (entre dans le calcul et peut faire baisser
 * le score). Choisir l'un pour l'autre n'est pas un détail : pour l'intention
 * `conversion`, le signal conversion pèse 0,70.
 *
 * LA DÉMONSTRATION qui tranche : `attribute()` (attribute.ts) donne à CHAQUE contenu d'une
 * fenêtre un poids strictement positif (`1/n`, le dernier absorbant le résidu `1 - cumul`,
 * lui aussi ≈ `1/n`). Un contenu passé par au moins une fenêtre de conversion a donc
 * TOUJOURS au moins une ligne `conversion_attributions` de poids > 0, et par conséquent :
 *
 *     somme == 0  ⟺  zéro ligne d'attribution  ⟺  ce contenu n'a JAMAIS été dans une fenêtre
 *
 * L'état « il était dans des fenêtres et n'a rien capté » est INATTEIGNABLE. Un
 * `coalesce(sum(...), 0)` fabriquait donc un zéro MESURÉ à partir d'une absence de mesure,
 * et plafonnait à 0,30/1 (confiance ~0,9) tout contenu d'intention conversion de toute
 * marque n'ayant déclaré aucune conversion — verdict ensuite gravé en mémoire à la salience
 * la plus haute du fil "reception" par le script de recalcul.
 *
 * D'où la règle portée ici : l'agrégat SQL est un `sum()` SANS `coalesce` — sur zéro ligne
 * Postgres renvoie `NULL`, exactement le canal « non mesuré ». Un `0` EXPLICITE, lui, reste
 * un 0 mesuré : la sémantique de score.ts n'est pas touchée (elle est correcte et ses
 * propres tests l'épinglent), on cesse simplement de lui mentir.
 */
export function creditSumFromAggregate(raw: string | number | null | undefined): number | null {
  // Aucune ligne d'attribution : `sum()` renvoie NULL (et `undefined` si aucune ligne
  // d'agrégat n'est remontée du tout). Non mesuré.
  if (raw === null || raw === undefined) return null;
  // Le driver peut rendre un `numeric` sous forme de texte : on normalise sans jamais
  // laisser passer un NaN.
  const n = typeof raw === "number" ? raw : Number(raw);
  // Illisible = on ne sait pas, donc NON MESURÉ. Fabriquer un 0 ici referait exactement le
  // défaut C1 ; laisser filer un NaN empoisonnerait le score en aval.
  return Number.isFinite(n) ? n : null;
}
