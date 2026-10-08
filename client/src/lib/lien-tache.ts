/**
 * Lien interne porté par une tâche (`tasks.actionData.lien`), ex. la tâche « Valider les
 * messages préparés par Naya » qui ouvre l'onglet Prospects de sa campagne.
 * Seuls les chemins internes (« /… », pas « //… ») sont suivis.
 */
export function lienInterneDeTache(task: { actionData?: unknown } | null | undefined): string | null {
  const lien = (task?.actionData as any)?.lien;
  if (typeof lien !== "string") return null;
  if (!lien.startsWith("/") || lien.startsWith("//")) return null;
  return lien;
}

/** Onglet demandé par `?onglet=` s'il fait partie des onglets permis, sinon le défaut. */
export function ongletDepuisRecherche<T extends string>(search: string, permis: readonly T[], defaut: T): T {
  const v = new URLSearchParams(search).get("onglet");
  return (permis as readonly string[]).includes(v ?? "") ? (v as T) : defaut;
}
