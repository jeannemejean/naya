// `POST /api/content/reception/import` renvoie un tableau d'erreurs qui mélange DEUX formes
// structurellement différentes, jamais les deux à la fois sur une même entrée :
// - une erreur de PARSING CSV porte le numéro de ligne physique du fichier (`line`) ;
// - une erreur d'INGESTION porte le contenu et la plateforme visés (`contentId`, `platform`),
//   jamais de numéro de ligne (elle survient après le parsing, sur une ligne déjà valide).
//
// Cette fonction est PURE — aucun i18n, aucun DOM — pour rester testable isolément : elle ne
// fabrique pas de texte affichable, elle range chaque entrée dans sa forme (`line` ou
// `content`) sans jamais supposer que `line` existe, et sans jamais perdre une entrée qui en
// serait dépourvue. Le composant appelant choisit la traduction à partir de `kind`.

export interface ReceptionImportRawError {
  line?: number;
  contentId?: number;
  platform?: string;
  message: string;
}

export type ReceptionImportErrorRow =
  | { key: string; kind: "line"; line: number; message: string }
  | { key: string; kind: "content"; contentId: number | undefined; platform: string | undefined; message: string };

/**
 * Normalise le tableau d'erreurs mixte du serveur en lignes affichables, une par erreur,
 * dans l'ordre reçu. Aucune entrée n'est filtrée ou fusionnée : une ligne de CSV en échec et
 * un contenu en échec d'ingestion sont deux erreurs distinctes à montrer toutes les deux.
 */
export function normalizeReceptionImportErrors(errors: ReceptionImportRawError[]): ReceptionImportErrorRow[] {
  return errors.map((error, index) => {
    if (typeof error.line === "number") {
      return { key: `line-${error.line}-${index}`, kind: "line", line: error.line, message: error.message };
    }
    return {
      key: `content-${error.contentId ?? "?"}-${error.platform ?? "?"}-${index}`,
      kind: "content",
      contentId: error.contentId,
      platform: error.platform,
      message: error.message,
    };
  });
}
