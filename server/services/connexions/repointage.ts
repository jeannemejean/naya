// server/services/connexions/repointage.ts — les posts programmés suivent les comptes de leur
// projet (« marques », 23 nov. 2026).
//
// La programmation épingle le compte (`socialAccountId`). Un projet perso sans compte propre
// pour un réseau utilise celui des Réglages ; dès qu'il connecte le sien, celui des Réglages sort
// de son périmètre (comptesDuPerimetre) et les posts déjà programmés échoueraient
// (« compte_hors_projet »). À la connexion, ils suivent donc le nouveau compte ; à la
// déconnexion d'un compte propre (projet perso seulement), ils repartent sur celui des Réglages
// s'il existe — sinon ils restent, et la suppression du compte les arrête avec l'alerte habituelle.
// Chaque post déplacé est journalisé (historique du post).
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { content } from "@shared/schema";
import { comptesDuPerimetre, type PorteeReseaux } from "./portee";
import { journaliser } from "../gestion-posts/historique";

type Compte = { id: number; platform: string; projectId?: number | null; isActive?: boolean | null };
type PostEnAttente = { id: number; platform: string | null; socialAccountId: number | null };

export interface DepsRepointage {
  comptes(userId: string): Promise<Compte[]>;
  /** Posts du projet pas encore partis (ni publiés, ni en cours, ni à la corbeille). */
  postsEnAttente(userId: string, projectId: number): Promise<PostEnAttente[]>;
  /** Re-pointe un post s'il vise toujours `de` et n'est toujours pas parti ; rend false sinon. */
  repointer(userId: string, id: number, de: number, vers: number): Promise<boolean>;
  journaliser(userId: string, contentId: number, evenement: "compte_change", details: Record<string, unknown>): Promise<void>;
}

/** Le réseau d'un compte ou d'un post : une page LinkedIn est du LinkedIn. */
export function reseauDe(platform: string | null | undefined): string {
  const p = String(platform ?? "").trim().toLowerCase();
  return p.startsWith("linkedin") ? "linkedin" : p;
}

async function deplacer(deps: DepsRepointage, userId: string, posts: PostEnAttente[], vers: number, raison: string): Promise<number[]> {
  const faits: number[] = [];
  for (const p of posts) {
    try {
      if (!(await deps.repointer(userId, p.id, p.socialAccountId as number, vers))) continue;
      faits.push(p.id);
      await deps.journaliser(userId, p.id, "compte_change", { de: p.socialAccountId, vers, raison });
    } catch (e: any) {
      console.error(`[Comptes] post ${p.id} non re-pointé :`, e?.message || e);
    }
  }
  return faits;
}

/** Après la connexion d'un compte propre au projet pour `reseau`. Rend les posts déplacés. */
export async function repointerApresConnexion(deps: DepsRepointage, userId: string, p: PorteeReseaux, reseau: string): Promise<number[]> {
  if (p.portee == null) return [];
  const comptes = await deps.comptes(userId);
  const r = reseauDe(reseau);
  const nouveau = comptes.find((c) => (c.projectId ?? null) === p.portee && reseauDe(c.platform) === r && c.isActive !== false);
  if (!nouveau) return [];
  const permis = new Set(comptesDuPerimetre(comptes, p).map((c) => c.id));
  const posts = (await deps.postsEnAttente(userId, p.portee)).filter((x) =>
    x.socialAccountId != null && x.socialAccountId !== nouveau.id && !permis.has(x.socialAccountId) && reseauDe(x.platform) === r);
  return deplacer(deps, userId, posts, nouveau.id, "connexion");
}

/** Avant la déconnexion d'un compte propre au projet. Rend les posts déplacés. */
export async function repointerAvantDeconnexion(deps: DepsRepointage, userId: string, p: PorteeReseaux, compte: Compte): Promise<number[]> {
  if (p.portee == null || !p.repli) return [];
  const comptes = await deps.comptes(userId);
  const r = reseauDe(compte.platform);
  // Le compte des Réglages qui reprendra : même plateforme d'abord (une page LinkedIn → le
  // profil seulement s'il n'y a pas de page aux Réglages), toujours actif.
  const reglages = comptes.filter((c) => (c.projectId ?? null) === null && c.isActive !== false && reseauDe(c.platform) === r);
  const vers = reglages.find((c) => c.platform === compte.platform) ?? reglages.find((c) => c.platform === r) ?? reglages[0];
  if (!vers) return [];
  const posts = (await deps.postsEnAttente(userId, p.portee)).filter((x) => x.socialAccountId === compte.id);
  return deplacer(deps, userId, posts, vers.id, "deconnexion");
}

const EN_COURS_OU_PUBLIE = ["posted", "posting", "processing", "uploading"];
const pasParti = and(
  isNull(content.publishedAt), isNull(content.supprimeLe),
  notInArray(sql`coalesce(${content.postStatus}, 'pending')`, EN_COURS_OU_PUBLIE),
);

export const depsRepointage: DepsRepointage = {
  comptes: (userId) => storage.getSocialAccounts(userId) as any,
  postsEnAttente: (userId, projectId) => db.select({ id: content.id, platform: content.platform, socialAccountId: content.socialAccountId })
    .from(content).where(and(eq(content.userId, userId), eq(content.projectId, projectId), pasParti)),
  async repointer(userId, id, de, vers) {
    // `updated_at` n'est pas touché : ce n'est pas une modification de l'utilisatrice (une
    // autoliste reconstruite ne doit pas prendre ce post pour un post retouché).
    const r = await db.update(content).set({ socialAccountId: vers } as any)
      .where(and(eq(content.id, id), eq(content.userId, userId), eq(content.socialAccountId, de), pasParti))
      .returning({ id: content.id });
    return r.length > 0;
  },
  journaliser: (userId, contentId, evenement, details) => journaliser(userId, contentId, evenement, details),
};
