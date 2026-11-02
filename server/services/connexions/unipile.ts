// server/services/connexions/unipile.ts — retrouver le bon compte LinkedIn chez Unipile.
// Chaque compte est créé avec un nom : l'id de l'utilisatrice, ou `<id>:projet:<n>` pour un
// projet client. Un projet ne prend que le compte à son nom ; jamais de repli.

export function nomUnipile(userId: string, projectId: number | null): string {
  return projectId == null ? userId : `${userId}:projet:${projectId}`;
}

/** Valeur `type` d'un compte Gmail/Google chez Unipile (doc : GET /api/v1/accounts, enum "GOOGLE_OAUTH"). */
export const TYPE_UNIPILE_GMAIL = "GOOGLE_OAUTH";
export type TypeCompteUnipile = "LINKEDIN" | typeof TYPE_UNIPILE_GMAIL;

const estDeProjet = (nom: string | undefined) => !!nom && nom.includes(":projet:");

export function compteUnipile<C extends { id: string; name?: string; type?: string }>(
  tous: C[], userId: string, projectId: number | null, type: TypeCompteUnipile,
): C | undefined {
  // Un compte sans type (anciennes données) est un compte LinkedIn : Gmail est arrivé après.
  const comptes = tous.filter((c) => (c.type ?? "LINKEDIN") === type);
  const nom = nomUnipile(userId, projectId);
  const exact = comptes.find((c) => c.name === nom);
  if (exact || projectId != null) return exact;
  // Repli historique LinkedIn (comptes créés avant le nommage), jamais pour Gmail : l'unique compte présent, à condition
  // qu'il ne soit pas celui d'un projet client.
  return type === "LINKEDIN" && comptes.length === 1 && !estDeProjet(comptes[0].name) ? comptes[0] : undefined;
}

/**
 * Le profil LinkedIn du compte choisi est-il déjà utilisé par un autre périmètre ? Chaque
 * connexion Unipile a son propre id, mais le même profil connecté deux fois aurait deux
 * budgets alors que LinkedIn n'en voit qu'un. Profil inconnu → on ne bloque pas.
 */
export function profilDejaUtilise(
  comptes: Array<{ id: string; profil?: string | null }>, choisi: string, utilisesAilleurs: Array<string | null | undefined>,
): boolean {
  const profil = comptes.find((c) => c.id === choisi)?.profil;
  if (!profil) return false;
  return utilisesAilleurs.some((id) => id && id !== choisi && comptes.find((c) => c.id === id)?.profil === profil);
}

/**
 * `comptesDeconnectes` sans la clé du canal qu'on vient de resynchroniser (une synchro réussie
 * efface l'alerte de déconnexion de CE canal seulement). Retourne null s'il ne reste rien.
 */
export function sansDeconnexion(
  actuel: unknown, canal: "email" | "linkedin",
): { email?: string; linkedin?: string } | null {
  const { [canal]: _retire, ...reste } = (actuel && typeof actuel === "object" ? actuel : {}) as Record<string, string>;
  return Object.keys(reste).length ? reste : null;
}
