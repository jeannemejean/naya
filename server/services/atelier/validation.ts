// L'atelier de contenu : valider un post (spec 2026-10-14, partie 3).
//
// Validé = prêt à partir. Avec un compte connecté, le post est PROGRAMMÉ (`auto_post`) : Naya
// le publie seule à son heure (worker social-publisher). Sans compte, il est validé quand même
// et une tâche « Publier » de 5 min attend le jour J. Rien n'est programmé si le post publié
// ne serait pas celui prévu (texte vide, date passée, visuel ou vidéo manquants).
import type { GenreMedia } from "@shared/programmation";
import { problemesProgrammation, plateformeDe } from "@shared/programmation";
import { etatPost, genreDuPost, lundiDe, manquesPourValider, plusJours, type Manque } from "@shared/atelier";
import { estEtapeEcran, estTachePublier, jourDuPost, postAProduire } from "../campagne/production";

const EN_COURS = ["posting", "uploading", "processing"];
export const FORMATS_POST = ["feed_image", "text", "carousel", "feed_video", "reel", "short", "story"] as const;
const DUREE_PUBLIER = 5;

export interface DepsValidation {
  lirePost(id: number, userId: string): Promise<any | undefined>;
  majPost(id: number, userId: string, patch: Record<string, unknown>): Promise<any>;
  mediasDuPost(userId: string, post: any): Promise<GenreMedia[]>;
  /** Le compte qui publierait ce post (périmètre du projet respecté), ou null. */
  compteDuPost(userId: string, post: any): Promise<{ id: number; platform: string; isActive?: boolean | null; expiresAt?: Date | string | null } | null>;
  tachesDuPost(userId: string, contentId: number): Promise<any[]>;
  archiverTaches(userId: string, ids: number[]): Promise<void>;
  creerTache(t: Record<string, unknown>): Promise<any>;
  majTache(userId: string, id: number, patch: Record<string, unknown>): Promise<void>;
  postsEntre(userId: string, debut: Date, fin: Date): Promise<any[]>;
  tachesAtelier(userId: string, semaine: string): Promise<any[]>;
  cocherTaches(userId: string, ids: number[]): Promise<void>;
  maintenant(): Date;
}

export type ResultatValidation =
  | { statut: "programme" | "a_publier_soi_meme" }
  | { statut: "manques"; manques: Array<Manque | "trop_de_visuels"> }
  | { statut: "introuvable" | "en_cours" | "deja_publie" | "deja_valide" | "invalide" };

export interface Modifications { body?: unknown; title?: unknown; scheduledFor?: unknown; postFormat?: unknown }

/** Modifications acceptées, ou null si l'une est invalide. */
export function lireModifications(m: Modifications): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (typeof m.body === "string") patch.body = m.body.slice(0, 5000);
  if (typeof m.title === "string" && m.title.trim()) patch.title = m.title.trim().slice(0, 300);
  if (m.scheduledFor !== undefined) {
    const d = typeof m.scheduledFor === "string" ? new Date(m.scheduledFor) : null;
    if (!d || isNaN(d.getTime())) return null;
    patch.scheduledFor = d;
  }
  if (m.postFormat !== undefined) {
    if (!(FORMATS_POST as readonly unknown[]).includes(m.postFormat)) return null;
    patch.postFormat = m.postFormat;
  }
  return patch;
}

/** Jour et heure de Paris d'un instant. */
export function jourHeureParis(d: Date): { jour: string; heure: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
}
const plusMinutes = (hhmm: string, n: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(24 * 60 - 1, h * 60 + m + n);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

const nonFaites = (ts: any[]) => ts.filter((t) => !t.completed && !t.archivedAt);

/** Toute la semaine du post est prête : ses tâches d'atelier non faites sont cochées. */
async function cocherSiSemainePrete(deps: DepsValidation, userId: string, post: any) {
  const lundi = lundiDe(jourDuPost(post.scheduledFor));
  const aujourdhui = jourHeureParis(deps.maintenant()).jour;
  const posts = (await deps.postsEntre(userId, new Date(`${plusJours(lundi, -1)}T00:00:00Z`), new Date(`${plusJours(lundi, 8)}T00:00:00Z`)))
    .filter((p) => p.scheduledFor && lundiDe(jourDuPost(p.scheduledFor)) === lundi && postAProduire(p, aujourdhui));
  if (posts.some((p) => !["valide", "publie"].includes(etatPost(p)))) return;
  const ouvertes = nonFaites(await deps.tachesAtelier(userId, lundi));
  if (ouvertes.length) await deps.cocherTaches(userId, ouvertes.map((t) => t.id));
}

export async function validerPost(deps: DepsValidation, userId: string, id: number, modifs: Modifications): Promise<ResultatValidation> {
  let post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  if (EN_COURS.includes(post.postStatus)) return { statut: "en_cours" };
  if (etatPost(post) === "publie") return { statut: "deja_publie" };
  // Un post validé part tel quel : on ne le change pas sous le worker (on le dévalide d'abord).
  if (etatPost(post) === "valide") return { statut: "deja_valide" };
  const patch = lireModifications(modifs);
  if (!patch) return { statut: "invalide" };
  if (etatPost(post) === "a_rediger") {
    // Son texte est encore la CONSIGNE du plan : jamais publiée. Un texte différent envoyé ici
    // est celui de l'utilisatrice : le post devient un brouillon (la consigne est mise de côté).
    const ecrit = typeof patch.body === "string" && patch.body.trim() && patch.body.trim() !== (post.body ?? "").trim();
    if (!ecrit) return { statut: "manques", manques: ["redaction"] };
    patch.contentStatus = "draft";
    if (post.consigne == null) patch.consigne = (post.body ?? "").trim() || post.title || "—";
  }
  if (Object.keys(patch).length) post = await deps.majPost(id, userId, patch);

  const maintenant = deps.maintenant();
  const medias = await deps.mediasDuPost(userId, post);
  const manques: Array<Manque | "trop_de_visuels"> = manquesPourValider({
    genre: genreDuPost(post), body: post.body, scheduledFor: post.scheduledFor, medias, maintenant,
  });
  const compte = await deps.compteDuPost(userId, post);
  const problemes = problemesProgrammation({ post, medias, compte, maintenant });
  // Ce que le réseau lui-même refuserait : Instagram sans visuel, carrousel trop long.
  if (problemes.includes("visuel_requis") && !manques.includes("visuel")) manques.push("visuel");
  if (problemes.includes("trop_de_visuels")) manques.push("trop_de_visuels");
  if (manques.length) return { statut: "manques", manques };

  const sansCompte = problemes.some((p) => ["compte_absent", "compte_expire", "plateforme_non_supportee"].includes(p));
  const taches = await deps.tachesDuPost(userId, id);
  const publierExistante = nonFaites(taches).find((t) => estTachePublier(t.title));

  if (!sansCompte) {
    await deps.majPost(id, userId, {
      autoPost: true, postStatus: "pending", lastError: null, socialAccountId: compte!.id,
      platform: plateformeDe(post.platform), contentStatus: "ready",
    });
  } else {
    await deps.majPost(id, userId, { contentStatus: "ready", autoPost: false });
    const { jour, heure } = jourHeureParis(new Date(post.scheduledFor));
    const champs = {
      scheduledDate: jour, scheduledTime: heure, scheduledEndTime: plusMinutes(heure, DUREE_PUBLIER),
      estimatedDuration: DUREE_PUBLIER, actionData: { postContent: post.body, platform: plateformeDe(post.platform), contentId: id },
    };
    if (publierExistante) await deps.majTache(userId, publierExistante.id, { ...champs, taskType: "post_publish" });
    else {
      await deps.creerTache({
        userId, projectId: post.projectId ?? undefined, campaignId: post.campaignId ?? undefined, contentId: id,
        title: `Publier — ${(post.title || "post").slice(0, 120)}`,
        description: "Publie ce post toi-même : aucun compte n'est connecté pour ce réseau. Le texte est prêt à copier.",
        type: "content", category: "engagement", priority: 2, taskEnergyType: "execution", source: "campaign",
        taskType: "post_publish", completed: false, ...champs,
      });
    }
  }

  // Les anciennes étapes d'écran n'ont plus d'objet (la « Publier » de secours reste).
  const garder = sansCompte && publierExistante ? publierExistante.id : null;
  const aArchiver = nonFaites(taches).filter((t) => estEtapeEcran(t.title) && t.id !== garder).map((t) => t.id);
  if (aArchiver.length) await deps.archiverTaches(userId, aArchiver);

  await cocherSiSemainePrete(deps, userId, { ...post, contentStatus: "ready" }).catch((e) =>
    console.error("[atelier] coche des tâches d'atelier :", e?.message ?? e));
  return { statut: sansCompte ? "a_publier_soi_meme" : "programme" };
}

/** Annule la validation : le post redevient un brouillon, il ne part plus seul. */
export async function devaliderPost(deps: DepsValidation, userId: string, id: number): Promise<ResultatValidation | { statut: "brouillon" }> {
  const post = await deps.lirePost(id, userId);
  if (!post) return { statut: "introuvable" };
  if (EN_COURS.includes(post.postStatus)) return { statut: "en_cours" };
  if (etatPost(post) === "publie") return { statut: "deja_publie" };
  await deps.majPost(id, userId, { autoPost: false, postStatus: "pending", contentStatus: "draft" });
  const publier = nonFaites(await deps.tachesDuPost(userId, id)).filter((t) => estTachePublier(t.title)).map((t) => t.id);
  if (publier.length) await deps.archiverTaches(userId, publier);
  return { statut: "brouillon" };
}
