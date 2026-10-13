// Ce que le journal des requêtes et les en-têtes HTTP font des liens privés (rapports client) :
// le jeton ne s'écrit jamais en clair dans les journaux, le contenu du rapport non plus, et la
// page n'est jamais indexée. PUR.

const RAPPORT_PUBLIC = /^\/api\/public\/rapports\/[^/]+/;

export function cheminJournal(chemin: string): string {
  return chemin.replace(RAPPORT_PUBLIC, "/api/public/rapports/[jeton]");
}

export function corpsJournalisable(chemin: string): boolean {
  return !RAPPORT_PUBLIC.test(chemin);
}

export function estPagePrivee(chemin: string): boolean {
  return chemin.startsWith("/rapport/");
}
