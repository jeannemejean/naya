// server/services/connexions/oauth-garde.ts — à la connexion d'un compte social : une même
// identité (compte Instagram, page LinkedIn…) n'appartient qu'à un seul périmètre. Pour un
// client, on se connecte souvent avec SON PROPRE login (LinkedIn n'a pas de login de page) :
// sans cette garde, le profil de l'utilisatrice et toutes ses pages atterriraient chez le client.

type Compte = { platform: string; accountId: string; projectId?: number | null };

/** null si le compte peut être rangé dans `projectId` ; sinon la raison du refus. */
export function conflitIdentite(
  comptes: Compte[], cible: { platform: string; accountId: string; projectId: number | null },
): "compte_de_l_utilisatrice" | "compte_d_un_autre_projet" | null {
  const memes = comptes.filter((c) => c.platform === cible.platform && c.accountId === cible.accountId);
  for (const c of memes) {
    const p = c.projectId ?? null;
    if (p === cible.projectId) continue;
    return p == null ? "compte_de_l_utilisatrice" : "compte_d_un_autre_projet";
  }
  return null;
}

/** Pages LinkedIn qu'un périmètre peut recevoir : jamais une page déjà rattachée à un autre périmètre. */
export function pagesLinkedinPourClient<P extends { id: string }>(pages: P[], comptes: Compte[], projectId: number | null): P[] {
  return pages.filter((p) => conflitIdentite(comptes, { platform: `linkedin_page_${p.id}`, accountId: p.id, projectId }) == null);
}
