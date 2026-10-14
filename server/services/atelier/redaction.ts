// L'atelier de contenu : Naya rédige le texte d'un post à partir de sa consigne (l'idée du
// plan de campagne), dans la voix de la marque — l'utilisatrice corrige au lieu d'écrire.
//
// Jamais deux rédactions automatiques d'un même post : rédiger commence par mettre la
// consigne de côté (`content.consigne`, posée seulement si elle est vide). Deux onglets, le
// passage en arrière-plan et l'ouverture de l'atelier peuvent demander la même chose : un
// seul gagne le verrou, les autres ne dépensent rien. En cas d'échec, le verrou est rendu.
import { etatPost } from "@shared/atelier";
import { postModifiable } from "@shared/livrables";

export interface PostARediger {
  id: number; projectId?: number | null; campaignId?: number | null;
  title?: string | null; body?: string | null; consigne?: string | null;
  platform?: string | null; postFormat?: string | null; contentType?: string | null;
  pillar?: string | null; goal?: string | null;
  contentStatus?: string | null; autoPost?: boolean | null; postStatus?: string | null; publishedAt?: unknown;
}

export interface DepsRedaction {
  lirePost(id: number, userId: string): Promise<PostARediger | undefined>;
  /** Pose la consigne si elle est vide ; vrai si ce passage a pris le verrou. */
  reserverRedaction(id: number, userId: string, consigne: string): Promise<boolean>;
  /** Écrit le texte rédigé (le post devient un brouillon). */
  ecrireBrouillon(id: number, userId: string, body: string): Promise<void>;
  /** Rend le verrou après un échec (consigne remise à vide). */
  liberer(id: number, userId: string): Promise<void>;
  /** null : la dépense est permise. */
  garde(userId: string): Promise<unknown | null>;
  ia(userId: string, projectId: number | null, prompt: string): Promise<string>;
}

export type ResultatRedaction =
  | { statut: "redige"; body: string }
  | { statut: "deja" | "refus" | "erreur" | "introuvable" };

const FORMATS: Record<string, string> = {
  feed_image: "post avec une image", text: "post texte seul", carousel: "carrousel (légende du carrousel, puis le texte de chaque slide numérotée)",
  reel: "script de vidéo courte (accroche des 3 premières secondes, puis le déroulé) et sa légende",
  short: "script de vidéo courte (accroche des 3 premières secondes, puis le déroulé) et sa légende",
  feed_video: "script de vidéo (accroche, déroulé) et sa légende", story: "story (texte court, à l'écran)",
};

/** La demande faite à l'IA. `actuel` + `retouche` : on réécrit un brouillon selon une consigne courte. */
export function consigneRedaction(post: PostARediger, idee: string, actuel: string | null, retouche: string | null): string {
  const format = FORMATS[(post.postFormat || "").toLowerCase()] ?? "post";
  const lignes = [
    `Écris le texte d'un ${format} pour ${post.platform || "les réseaux sociaux"}.`,
    `Sujet (titre interne, pas forcément l'accroche) : ${post.title || "—"}`,
    `L'idée prévue dans le plan : ${idee || "—"}`,
    post.pillar ? `Pilier : ${post.pillar}` : "",
    post.goal ? `Objectif : ${post.goal}` : "",
  ].filter(Boolean);
  if (actuel) {
    lignes.push("", "Le texte actuel, à réécrire :", actuel);
    lignes.push("", `Ce qu'il faut changer : ${retouche || "propose une autre version, meilleure"}`);
  }
  lignes.push(
    "",
    "Règles :",
    "- Dans la voix de la marque (contexte ci-dessus), à la manière de quelqu'un qui écrit lui-même, jamais corporate.",
    "- Une accroche forte en première ligne ; des paragraphes courts ; adapté aux usages du réseau.",
    "- N'invente aucun chiffre, aucun client, aucun témoignage, aucune citation : s'il en faut un, écris [à compléter].",
    "- Écris dans la langue de l'idée prévue.",
    "- Réponds uniquement avec le texte du post, prêt à publier : pas de titre, pas de commentaire, pas de guillemets.",
  );
  return lignes.join("\n");
}

/** Ce que le modèle ajoute parfois autour du texte. */
export function nettoyerTexte(brut: string): string {
  let t = (brut ?? "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  t = t.replace(/^(voici|here is|here's)[^\n]*:\s*\n+/i, "").trim();
  if (t.length > 1 && /^["«“]/.test(t) && /["»”]$/.test(t)) t = t.slice(1, -1).trim();
  return t;
}

async function ecrire(deps: DepsRedaction, userId: string, post: PostARediger, prompt: string, liberer: boolean): Promise<ResultatRedaction> {
  try {
    const texte = nettoyerTexte(await deps.ia(userId, post.projectId ?? null, prompt));
    if (!texte) throw new Error("reponse_vide");
    await deps.ecrireBrouillon(post.id, userId, texte.slice(0, 5000));
    return { statut: "redige", body: texte.slice(0, 5000) };
  } catch (e: any) {
    console.error(`[atelier] rédaction du post ${post.id} :`, e?.message ?? e);
    if (liberer) await deps.liberer(post.id, userId).catch(() => {});
    return { statut: "erreur" };
  }
}

const modifiable = (p: PostARediger) =>
  postModifiable(p.postStatus) && !["valide", "publie"].includes(etatPost(p));

/** Rédaction automatique : une seule fois par post de campagne encore « à rédiger ». */
export async function redigerPost(deps: DepsRedaction, userId: string, id: number): Promise<ResultatRedaction> {
  const post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  // Un post manuel est le texte de l'utilisatrice : Naya ne l'écrase jamais d'elle-même.
  if (post.campaignId == null || !modifiable(post) || etatPost(post) !== "a_rediger") return { statut: "deja" };
  if (await deps.garde(userId)) return { statut: "refus" };
  const idee = (post.body ?? "").trim() || (post.title ?? "").trim();
  if (!(await deps.reserverRedaction(id, userId, idee))) return { statut: "deja" };
  return ecrire(deps, userId, post, consigneRedaction(post, idee, null, null), true);
}

/** « Refaire » : nouvelle version, demandée par l'utilisatrice, avec une consigne courte facultative. */
export async function refairePost(deps: DepsRedaction, userId: string, id: number, retoucheBrute: string): Promise<ResultatRedaction> {
  const post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  if (!modifiable(post)) return { statut: "deja" };
  if (await deps.garde(userId)) return { statut: "refus" };
  const retouche = (retoucheBrute ?? "").trim().slice(0, 300);
  if (!post.consigne) {
    // Jamais rédigé : la consigne d'origine est mise de côté avant d'être remplacée.
    const idee = (post.body ?? "").trim() || (post.title ?? "").trim();
    if (!(await deps.reserverRedaction(id, userId, idee))) return refairePost(deps, userId, id, retouche);
    return ecrire(deps, userId, post, consigneRedaction(post, idee, null, retouche || null), true);
  }
  return ecrire(deps, userId, post, consigneRedaction(post, post.consigne, (post.body ?? "").trim() || null, retouche || null), false);
}
