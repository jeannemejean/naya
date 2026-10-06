// Filet de sécurité : le modèle numérote parfois les tâches en prose ("Task 2", "Tâche 1")
// alors que ces numéros n'ont aucun sens une fois les tâches enregistrées et replanifiées.
// On remplace chaque mention numérotée par le titre exact de la tâche visée.

// Article français optionnel absorbé (« la Tâche 1 » → « Titre », pas « la « Titre » »).
// Le lookbehind évite de toucher « subtask 2 » ou « multitâche 2 ».
const MENTION = /(?<!\p{L})(?:la\s+)?(?:Task|Tâche)\s*#?\s*(\d+)(?!\d)/giu;

/**
 * `titres[i]` = titre de la tâche d'index 0-based `i` dans la sortie IA. Le numéro écrit
 * dans le texte est 1-based (« Task 2 » = `titres[1]`). Index inconnu → « la tâche précédente ».
 */
export function remplacerReferencesNumerotees(texte: string, titres: string[]): string {
  if (!texte || typeof texte !== "string") return texte;
  return texte.replace(MENTION, (_m, num: string) => {
    const titre = titres[parseInt(num, 10) - 1];
    return titre ? `« ${titre} »` : "la tâche précédente";
  });
}
