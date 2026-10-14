// L'atelier de contenu : Naya rédige le texte d'un post à partir de sa consigne (l'idée du
// plan de campagne), dans la voix de la marque — l'utilisatrice corrige au lieu d'écrire.
//
// Jamais deux rédactions automatiques d'un même post : rédiger commence par mettre la
// consigne de côté (`content.consigne`, posée seulement si elle est vide). Deux onglets, le
// passage en arrière-plan et l'ouverture de l'atelier peuvent demander la même chose : un
// seul gagne le verrou, les autres ne dépensent rien. En cas d'échec, le verrou est rendu.
import { etatPost } from "@shared/atelier";
import { postModifiable } from "@shared/livrables";
import { extraireTendance } from "@shared/profils-veille";

export interface PostARediger {
  id: number; projectId?: number | null; campaignId?: number | null; tendanceProjetId?: number | null;
  title?: string | null; body?: string | null; consigne?: string | null;
  platform?: string | null; postFormat?: string | null; contentType?: string | null;
  pillar?: string | null; goal?: string | null;
  contentStatus?: string | null; autoPost?: boolean | null; postStatus?: string | null; publishedAt?: unknown;
}

export interface DepsRedaction {
  lirePost(id: number, userId: string): Promise<PostARediger | undefined>;
  /** Pose la consigne si elle est vide ; vrai si ce passage a pris le verrou. */
  reserverRedaction(id: number, userId: string, consigne: string): Promise<boolean>;
  /**
   * Écrit le texte rédigé (le post devient un brouillon). `siCorps` : seulement si le texte n'a
   * pas changé depuis (l'utilisatrice a pu écrire pendant la rédaction). `annexe` : le script ou
   * les slides, ajoutés à la consigne (jamais publiés). Vrai si écrit.
   */
  ecrireBrouillon(id: number, userId: string, body: string, opts: { siCorps?: string; annexe: string | null }): Promise<boolean>;
  /** Une étape d'écriture de l'ancien parcours est faite (le texte est celui de l'utilisatrice). */
  etapeEcritureFaite(userId: string, id: number): Promise<boolean>;
  /** Marque le post comme brouillon sans toucher à son texte. */
  marquerBrouillon(id: number, userId: string): Promise<void>;
  /** Rend le verrou après un échec (consigne remise à vide). */
  liberer(id: number, userId: string): Promise<void>;
  /** null : la dépense est permise. */
  garde(userId: string): Promise<unknown | null>;
  ia(userId: string, projectId: number | null, prompt: string, opts?: { plateformes: string[] }): Promise<string>;
  /** Relie le post à la tendance dont il s'inspire (tendances_projet → profil_tendances). */
  lierTendance(id: number, userId: string, tendanceProjetId: number): Promise<void>;
}

export type ResultatRedaction =
  | { statut: "redige"; body: string }
  | { statut: "deja" | "refus" | "erreur" | "introuvable" };

const FORMATS: Record<string, string> = {
  feed_image: "post avec une image", text: "post texte seul", carousel: "carrousel", reel: "vidéo courte",
  short: "vidéo courte", feed_video: "vidéo", story: "story (texte court, à l'écran)",
};
/** Formats dont le support (script, slides) n'est PAS la légende publiée. */
const ANNEXES: Record<string, string> = { carousel: "SLIDES", reel: "SCRIPT", short: "SCRIPT", feed_video: "SCRIPT" };

/** Sépare la légende (publiée) du script ou des slides (mis à part). Sans marqueur : tout est la légende. */
export function separerLegende(texte: string): { legende: string; annexe: string | null } {
  const m = /^\s*(script|slides)\s*:/im.exec(texte);
  const avant = m ? texte.slice(0, m.index) : texte;
  const legende = avant.replace(/^\s*l[ée]gende\s*:\s*/i, "").trim();
  return { legende, annexe: m ? texte.slice(m.index).trim() : null };
}

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
  const annexe = ANNEXES[(post.postFormat || "").toLowerCase()];
  if (actuel) {
    lignes.push("", annexe ? "La légende actuelle, à réécrire (la légende seulement) :" : "Le texte actuel, à réécrire :", actuel);
    lignes.push("", `Ce qu'il faut changer : ${retouche || "propose une autre version, meilleure"}`);
  } else if (annexe) {
    lignes.push(
      "",
      `Donne deux parties, exactement sous cette forme :`,
      `LÉGENDE :`,
      `<la légende publiée avec la ${annexe === "SLIDES" ? "publication" : "vidéo"}>`,
      `${annexe} :`,
      annexe === "SLIDES" ? "<le texte de chaque slide, numérotées>" : "<le script : l'accroche des 3 premières secondes, puis le déroulé>",
    );
  }
  lignes.push(
    "",
    "Règles :",
    "- Dans la voix de la marque (contexte ci-dessus), à la manière de quelqu'un qui écrit lui-même, jamais corporate.",
    "- Une accroche forte en première ligne ; des paragraphes courts ; adapté aux usages du réseau.",
    "- N'invente aucun chiffre, aucun client, aucun témoignage, aucune citation : s'il en faut un, écris [à compléter].",
    "- Écris dans la langue de l'idée prévue.",
    "- Si tu t'inspires d'un format de la liste « Ce qui marche en ce moment dans le secteur », termine par une ligne seule : TENDANCE: 12 (le numéro seul, sans crochets). Sinon, n'ajoute rien.",
    "- Réponds uniquement avec le texte demandé, prêt à publier : pas de titre, pas de commentaire, pas de guillemets.",
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

async function ecrire(
  deps: DepsRedaction, userId: string, post: PostARediger, prompt: string,
  { liberer, siCorps, separer }: { liberer: boolean; siCorps?: string; separer: boolean },
): Promise<ResultatRedaction> {
  try {
    const sortie = extraireTendance(nettoyerTexte(await deps.ia(userId, post.projectId ?? null, prompt, { plateformes: post.platform ? [post.platform] : [] })));
    const brut = sortie.texte;
    const { legende, annexe } = separer ? separerLegende(brut) : { legende: brut, annexe: null };
    const body = legende.slice(0, 5000);
    if (!body) throw new Error("reponse_vide");
    // Écrit entre-temps par l'utilisatrice : son texte gagne, la rédaction est jetée.
    if (!(await deps.ecrireBrouillon(post.id, userId, body, { ...(siCorps !== undefined ? { siCorps } : {}), annexe: annexe ? annexe.slice(0, 5000) : null }))) {
      return { statut: "deja" };
    }
    if (sortie.tendanceId != null) await deps.lierTendance(post.id, userId, sortie.tendanceId).catch(() => {});
    return { statut: "redige", body };
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
  if ((post.campaignId == null && post.tendanceProjetId == null) || !modifiable(post) || etatPost(post) !== "a_rediger") return { statut: "deja" };
  // Écrit à la main dans l'ancien parcours (« Rédiger le texte » faite) : jamais réécrit par Naya.
  if (await deps.etapeEcritureFaite(userId, id)) {
    await deps.marquerBrouillon(id, userId);
    return { statut: "deja" };
  }
  if (await deps.garde(userId)) return { statut: "refus" };
  const idee = (post.body ?? "").trim() || (post.title ?? "").trim();
  if (!(await deps.reserverRedaction(id, userId, idee))) return { statut: "deja" };
  return ecrire(deps, userId, post, consigneRedaction(post, idee, null, null), { liberer: true, siCorps: post.body ?? "", separer: true });
}

/** « Refaire » : nouvelle version, demandée par l'utilisatrice, avec une consigne courte facultative. */
export async function refairePost(deps: DepsRedaction, userId: string, id: number, retoucheBrute: string): Promise<ResultatRedaction> {
  let post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  if (!modifiable(post)) return { statut: "deja" };
  if (await deps.garde(userId)) return { statut: "refus" };
  const retouche = (retoucheBrute ?? "").trim().slice(0, 300);
  if (post.consigne == null) {
    // Jamais rédigé : la consigne d'origine est mise de côté avant d'être remplacée.
    const idee = (post.body ?? "").trim() || (post.title ?? "").trim();
    if (await deps.reserverRedaction(id, userId, idee)) {
      return ecrire(deps, userId, post, consigneRedaction(post, idee, null, retouche || null), { liberer: true, separer: true });
    }
    // Un autre passage vient de la poser : on relit une fois, sans boucler.
    post = (await deps.lirePost(id, userId)) ?? post;
  }
  const idee = (post.consigne ?? "").trim() || (post.title ?? "").trim();
  return ecrire(deps, userId, post, consigneRedaction(post, idee, (post.body ?? "").trim() || null, retouche || null), { liberer: false, separer: false });
}
