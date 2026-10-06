// Orchestration du refus d'un post, dépendances injectées (testable sans base).
import { estPublieOuEnCours, texteSouvenirPost, type PostRemplacement, type RaisonRefusPost } from "./pur";
import type { genererPostRemplacement } from "./remplacement";

export interface PostRefusable {
  id: number;
  userId: string;
  projectId: number | null;
  campaignId: number | null;
  socialAccountId: number | null;
  title: string;
  body: string;
  platform: string;
  contentType: string;
  pillar: string;
  goal: string;
  intent: string | null;
  scheduledFor: Date | null;
  postFormat: string | null;
  publishedAt: Date | null;
  postStatus: string | null;
  contentStatus: string | null;
  autoPost?: boolean | null;
}

export interface NouveauPost {
  userId: string;
  projectId: number | null;
  campaignId: number | null;
  socialAccountId: number | null;
  platform: string;
  contentType: string;
  pillar: string;
  goal: string;
  intent: string | null;
  scheduledFor: Date | null;
  postFormat: string | null;
  title: string;
  body: string;
  status: "draft";
  contentStatus: "idea";
  postStatus: "pending";
  // Toujours false : la colonne vaut true par défaut et le publieur publie seul les contenus échus.
  autoPost: false;
}

export interface RefusPostDeps {
  lirePost(id: number): Promise<PostRefusable | undefined>;
  ecrireSouvenir(input: { userId: string; projectId: number | null; texte: string }): Promise<void>;
  generer(input: Parameters<typeof genererPostRemplacement>[0]): Promise<PostRemplacement | null>;
  creerPost(row: NouveauPost): Promise<{ id: number } & Record<string, unknown>>;
  supprimerPost(id: number): Promise<void>;
}

export type ResultatRefusPost =
  | { statut: "introuvable" }
  | { statut: "deja_publie" }
  | { statut: "refuse"; remplacement: Record<string, unknown> | null; raison?: "generation_failed" };

// Étape best-effort : journalise et rend `fallback` en cas d'échec.
async function sansLever<T>(nom: string, f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.error(`[refus-post] ${nom} a échoué :`, e);
    return fallback;
  }
}

export async function refuserPost(
  deps: RefusPostDeps,
  input: { userId: string; contentId: number; raison: RaisonRefusPost; explication?: string | null; remplacer: boolean },
): Promise<ResultatRefusPost> {
  const { userId, contentId, raison, remplacer } = input;
  const explication = input.explication ?? null;

  // 1. Lecture + propriété : un post d'un autre compte est « introuvable ».
  const post = await deps.lirePost(contentId);
  if (!post || post.userId !== userId) return { statut: "introuvable" };
  // 2. Publié ou en cours de publication : aucune écriture.
  if (estPublieOuEnCours(post)) return { statut: "deja_publie" };

  // 3. Souvenir, seulement s'il y a quelque chose à apprendre.
  await sansLever("souvenir", async () => {
    const texte = texteSouvenirPost(post, raison, explication);
    if (texte !== null) await deps.ecrireSouvenir({ userId, projectId: post.projectId ?? null, texte });
  }, undefined);

  // 4. Remplacement (au choix) : génération puis création AVANT la suppression.
  let remplacement: Record<string, unknown> | null = null;
  let echec = false;
  if (remplacer) {
    const rempl = await sansLever(
      "génération",
      () => deps.generer({ userId, post, raison, explication }),
      null as PostRemplacement | null,
    );
    if (rempl) {
      remplacement = await sansLever<Record<string, unknown> | null>("création du remplacement", () =>
        deps.creerPost({
          userId,
          projectId: post.projectId ?? null,
          campaignId: post.campaignId ?? null,
          socialAccountId: post.socialAccountId ?? null,
          platform: post.platform,
          contentType: post.contentType,
          pillar: post.pillar,
          goal: post.goal,
          intent: post.intent ?? null,
          scheduledFor: post.scheduledFor ?? null,
          postFormat: post.postFormat ?? null,
          title: rempl.title,
          body: rempl.body,
          status: "draft",
          contentStatus: "idea",
          postStatus: "pending",
          autoPost: false,
        }), null);
    }
    if (!remplacement) echec = true;
  }

  // 5. Le post refusé disparaît dans tous les cas, une fois le refus valide.
  await sansLever("suppression", () => deps.supprimerPost(post.id), undefined);

  return { statut: "refuse", remplacement, ...(echec ? { raison: "generation_failed" as const } : {}) };
}
