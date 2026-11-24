// Autolistes (lot 6) : le passage qui pose les 7 prochains jours d'une liste en posts ordinaires
// du calendrier (autoPost), publiés ensuite par le worker habituel (social-publisher) — aucun
// second publieur. Chaque créneau est posé une fois par compte (index unique) ; un créneau passé
// n'est jamais posé ; une ligne refusée par les règles de « Programmer » n'est pas créée et la
// raison reste sur la liste. Dépendances injectées : testé sans base.
import {
  attribuer, avancer, bilanPublications, estReservation, fenetreDePose, fileDAttente, lignePourCreneau,
  ordreApresBoucle, problemesDeLaLigne, prochainsCreneaux,
  type Creneau, type Materialisation, type PostDeFile, type ProblemeAutoliste,
} from "@shared/autolistes";
import type { ContenuModele } from "@shared/bibliotheque";
import { plateformeDe, type GenreMedia } from "@shared/programmation";
import { contenuTelephone } from "@shared/finir-telephone";
import { choisirCompteReseaux, porteeReseauxDe } from "../connexions/portee";
import { descriptionPublier, jourHeureParis, plusMinutes } from "../atelier/validation";

export type ListeAutoliste = {
  id: number; userId: string; projectId: number | null; nom: string; actif: boolean; enBoucle: boolean;
  creneaux: unknown; comptes: unknown; fuseau: string;
};
export type PostAutoliste = PostDeFile & { contenu: unknown; publieFois: number; dernierPassageAt: Date | null };
export type ProblemeNote = { creneau: string; postId: number | null; compteId: number | null; raisons: Array<ProblemeAutoliste | "aucun_compte"> };

export interface DepsMaterialiser {
  maintenant(): Date;
  /** Les listes actives de toutes les utilisatrices (passage du planificateur). */
  listesActives(): Promise<ListeAutoliste[]>;
  liste(userId: string, id: number): Promise<ListeAutoliste | undefined>;
  posts(autolisteId: number): Promise<PostAutoliste[]>;
  /** Posts posés par la liste : créneau depuis `depuis`, ou vivants et pas encore partis. */
  materialisations(userId: string, autolisteId: number, depuis: Date): Promise<Materialisation[]>;
  publies(userId: string, autolisteId: number): Promise<Array<{ autolistePostId: number | null; autolisteCreneau: Date | null; publishedAt: Date | null }>>;
  majPost(autolisteId: number, id: number, maj: Record<string, unknown>): Promise<void>;
  projet(id: number, userId: string): Promise<{ id: number; projectKind?: string | null } | undefined>;
  comptes(userId: string): Promise<any[]>;
  medias(userId: string, ids: number[]): Promise<Array<{ id: number; url: string | null; mimeType: string | null }>>;
  /** Insère le post ; null si le créneau était déjà posé sur ce compte (index unique). */
  creerContenu(row: Record<string, any>): Promise<{ id: number } | null>;
  journaliser(userId: string, contentId: number, evenement: "cree" | "supprime", details?: Record<string, unknown> | null): Promise<void>;
  /** Crée une tâche (la « Publier — … » d'un post à finir sur le téléphone). */
  creerTache(t: Record<string, unknown>): Promise<{ id: number } | unknown>;
  /** Validation client active pour cette marque (lot 8) : les posts posés naissent « à valider ». */
  validationActive(projectId: number): Promise<boolean>;
  noterPassage(userId: string, autolisteId: number, problemes: ProblemeNote[], le: Date): Promise<void>;
  /**
   * Met à la corbeille les posts posés à venir, ni publiés ni en cours, ni modifiés dans le
   * calendrier depuis leur pose (ceux-là restent, avec leur créneau) ; libère leur créneau.
   */
  supprimerFuturs(userId: string, autolisteId: number, apres: Date, postId?: number): Promise<number[]>;
}

// Un passage à la fois par liste : le planificateur et une modification ne se croisent pas.
const verrous = new Map<number, Promise<unknown>>();
function enSerie<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const avant = verrous.get(id) ?? Promise.resolve();
  const suite = avant.catch(() => {}).then(fn);
  verrous.set(id, suite);
  return suite.finally(() => { if (verrous.get(id) === suite) verrous.delete(id); });
}

const tableau = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

type Fichier = { url: string; nom?: string | null; genre: GenreMedia };

/** Les médias du modèle, dans l'ordre (adresse et nature). */
async function fichiersDuContenu(deps: DepsMaterialiser, userId: string, contenu: ContenuModele): Promise<Fichier[]> {
  const ids = tableau<unknown>(contenu?.mediaIds).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const trouves = new Map((ids.length ? await deps.medias(userId, ids) : []).map((m) => [m.id, m]));
  const fichiers: Fichier[] = [];
  for (const id of ids) {
    const m = trouves.get(id);
    if (m?.url) fichiers.push({ url: m.url, genre: (m.mimeType || "").startsWith("video/") ? "video" : "image" });
  }
  if (fichiers.length === 0 && contenu?.mediaUrl) fichiers.push({ url: contenu.mediaUrl, nom: contenu.mediaFileName ?? null, genre: "image" });
  return fichiers;
}

/** La tâche « Publier — … » d'un post à finir sur le téléphone (mêmes champs que l'atelier). */
async function poserTachePublier(deps: DepsMaterialiser, ligne: Record<string, any>, contentId: number, fichiers: Fichier[]): Promise<void> {
  const DUREE = 5;
  const { jour, heure } = jourHeureParis(new Date(ligne.scheduledFor));
  const raisons = ["demande" as const];
  const telephone = contenuTelephone({ post: ligne as any, medias: fichiers, raisons });
  await deps.creerTache({
    userId: ligne.userId, projectId: ligne.projectId ?? undefined, contentId,
    title: `Publier — ${String(ligne.title || "post").slice(0, 120)}`,
    type: "content", category: "engagement", priority: 2, taskEnergyType: "execution", source: "campaign",
    taskType: "post_publish", completed: false,
    scheduledDate: jour, scheduledTime: heure, scheduledEndTime: plusMinutes(heure, DUREE), estimatedDuration: DUREE,
    description: descriptionPublier(raisons),
    actionData: { postContent: ligne.body, platform: plateformeDe(ligne.platform), contentId, telephone },
  });
}

/** Met à jour les compteurs des posts publiés ; sans boucle, un post publié est consommé. */
async function reconcilier(deps: DepsMaterialiser, liste: ListeAutoliste, posts: PostAutoliste[]): Promise<PostAutoliste[]> {
  const bilan = bilanPublications(await deps.publies(liste.userId, liste.id), liste.enBoucle);
  const sortie: PostAutoliste[] = [];
  for (const p of posts) {
    const b = bilan.get(p.id);
    if (!b) { sortie.push(p); continue; }
    const maj: Record<string, unknown> = {};
    if (b.publieFois !== p.publieFois) maj.publieFois = b.publieFois;
    const avant = p.dernierPassageAt ? new Date(p.dernierPassageAt).getTime() : null;
    if (b.dernierPassageAt && b.dernierPassageAt.getTime() !== avant) maj.dernierPassageAt = b.dernierPassageAt;
    // Consommé à sa (nouvelle) publication seulement : remis en file à la main, un post déjà
    // publié n'est pas re-désactivé par ses publications passées.
    if (b.consomme && p.actif && maj.publieFois !== undefined) maj.actif = false;
    if (Object.keys(maj).length) await deps.majPost(liste.id, p.id, maj);
    sortie.push({ ...p, ...(maj as Partial<PostAutoliste>) });
  }
  return sortie;
}

export type BilanPassage = { poses: number; problemes: ProblemeNote[] };

async function poser(deps: DepsMaterialiser, liste: ListeAutoliste): Promise<BilanPassage> {
  const maintenant = deps.maintenant();
  const posts = await reconcilier(deps, liste, await deps.posts(liste.id));
  const problemes: ProblemeNote[] = [];
  let poses = 0;
  if (!liste.actif) {
    await deps.noterPassage(liste.userId, liste.id, problemes, maintenant);
    return { poses, problemes };
  }
  const { depuis, jusqua } = fenetreDePose(maintenant);
  const instants = prochainsCreneaux(tableau<Creneau>(liste.creneaux), depuis, jusqua, liste.fuseau);
  const mats = await deps.materialisations(liste.userId, liste.id, depuis);
  // Les posts posés par créneau : un créneau est pris compte par compte (la clé anti-doublon est
  // par compte). Un créneau où un compte manque (refusé à son passage) est complété plus tard.
  const parCreneau = new Map<number, Materialisation[]>();
  for (const m of mats) {
    if (!m.autolisteCreneau) continue;
    const t = new Date(m.autolisteCreneau as any).getTime();
    parCreneau.set(t, [...(parCreneau.get(t) ?? []), m]);
  }
  const reserves = new Set(mats.filter(estReservation).map((m) => m.autolistePostId as number));
  let file = fileDAttente(posts, liste.enBoucle, reserves);
  const libres = instants.filter((i) => !parCreneau.has(i.getTime()));
  const idsComptes = tableau<number>(liste.comptes);
  const parId = new Map(posts.map((p) => [p.id, p]));
  // Créneaux partiels : au moins un post vivant posé, des comptes de la liste sans post.
  const partiels = instants.flatMap((i) => {
    const poses = parCreneau.get(i.getTime());
    if (!poses) return [];
    const vivant = poses.find((m) => !m.supprimeLe && m.autolistePostId != null && parId.has(m.autolistePostId));
    if (!vivant) return [];
    const dejaComptes = new Set(poses.map((m) => m.socialAccountId));
    const manquants = idsComptes.filter((c) => !dejaComptes.has(c));
    return manquants.length ? [{ creneau: i, postId: vivant.autolistePostId as number, comptes: manquants }] : [];
  });

  if (libres.length && file.length && idsComptes.length === 0) {
    problemes.push({ creneau: libres[0].toISOString(), postId: file[0], compteId: null, raisons: ["aucun_compte"] });
  } else if ((libres.length && file.length) || partiels.length) {
    const tous = await deps.comptes(liste.userId);
    const projet = liste.projectId != null ? await deps.projet(liste.projectId, liste.userId) : undefined;
    const portee = porteeReseauxDe(projet ?? null);
    const aValiderDepuis = liste.projectId != null && (await deps.validationActive(liste.projectId)) ? maintenant : null;

    /** Pose le post sur ces comptes à ce créneau ; rend le nombre de posts créés. */
    const poserCreneau = async (creneau: Date, postId: number, comptes: number[]): Promise<number> => {
      const contenu = parId.get(postId)!.contenu as ContenuModele;
      const fichiers = await fichiersDuContenu(deps, liste.userId, contenu);
      const medias = fichiers.map((f) => f.genre);
      let crees = 0;
      for (const compteId of comptes) {
        const brut = tous.find((c) => c.id === compteId);
        const choix = brut ? choisirCompteReseaux(tous, { platform: brut.platform, socialAccountId: compteId }, portee) : null;
        const compte = choix && "compte" in choix ? choix.compte : null;
        const ligne = brut ? lignePourCreneau(contenu, {
          userId: liste.userId, projectId: liste.projectId, compte: { id: compteId, platform: brut.platform }, creneau,
          autolisteId: liste.id, autolistePostId: postId, aValiderDepuis,
        }) : null;
        const raisons = !brut ? ["compte_absent" as const] : problemesDeLaLigne({
          ligne, medias, compte, horsProjet: !compte && choix != null && "erreur" in choix && choix.erreur === "compte_hors_projet", maintenant,
        });
        if (raisons.length) {
          problemes.push({ creneau: creneau.toISOString(), postId, compteId, raisons });
          continue;
        }
        const cree = await deps.creerContenu(ligne!);
        if (cree) {
          crees++;
          await deps.journaliser(liste.userId, cree.id, "cree", { autoliste: liste.nom });
          // Jamais publié seul : un rappel « Publier — … » avec la légende et les médias.
          if (ligne!.finirSurTelephone === true) {
            await poserTachePublier(deps, ligne!, cree.id, fichiers)
              .catch((e: any) => console.error(`[autolistes] tâche Publier du post ${cree.id} :`, e?.message ?? e));
          }
        }
      }
      return crees;
    };

    // D'abord les créneaux partiels : leur post est déjà choisi, la file ne bouge pas.
    for (const p of partiels) poses += await poserCreneau(p.creneau, p.postId, p.comptes);

    for (const creneau of file.length ? libres : []) {
      const { postId } = avancer(file, liste.enBoucle);
      if (postId == null) break;
      const crees = await poserCreneau(creneau, postId, idsComptes);
      // Aucune ligne posée pour ce créneau : le post garde sa place en tête de file (l'ordre de
      // l'utilisatrice est respecté) et le passage s'arrête là ; la raison reste sur la liste.
      if (crees === 0) break;
      poses += crees;
      file = attribuer(file, [creneau], liste.enBoucle).file;
    }
    if (liste.enBoucle && poses > 0) {
      for (const o of ordreApresBoucle(posts, file)) await deps.majPost(liste.id, o.id, { ordre: o.ordre });
    }
  }
  await deps.noterPassage(liste.userId, liste.id, problemes, maintenant);
  return { poses, problemes };
}

/** Pose les créneaux libres des 7 prochains jours d'une liste de l'utilisatrice. */
export async function materialiserAutoliste(deps: DepsMaterialiser, userId: string, autolisteId: number): Promise<BilanPassage | null> {
  return enSerie(autolisteId, async () => {
    const liste = await deps.liste(userId, autolisteId);
    return liste ? poser(deps, liste) : null;
  });
}

/**
 * Après une modification de la liste (créneaux, comptes, ordre, boucle, activation) : les posts
 * posés à venir (ni publiés ni en cours) partent à la corbeille, puis la liste est reposée.
 */
export async function reconstruireAutoliste(deps: DepsMaterialiser, userId: string, autolisteId: number): Promise<BilanPassage | null> {
  return enSerie(autolisteId, async () => {
    const liste = await deps.liste(userId, autolisteId);
    if (!liste) return null;
    const ids = await deps.supprimerFuturs(userId, autolisteId, deps.maintenant());
    for (const id of ids) await deps.journaliser(userId, id, "supprime", { autoliste: liste.nom });
    return poser(deps, liste);
  });
}

/**
 * Retire un post de la file : ses posts posés à venir partent à la corbeille, le post est
 * supprimé (`retirer`), puis la liste est reposée (les créneaux libérés passent au suivant).
 */
export async function retirerDeLaFile(
  deps: DepsMaterialiser, userId: string, autolisteId: number, postId: number, retirer: () => Promise<boolean>,
): Promise<boolean> {
  return enSerie(autolisteId, async () => {
    const liste = await deps.liste(userId, autolisteId);
    if (!liste) return false;
    const ids = await deps.supprimerFuturs(userId, autolisteId, deps.maintenant(), postId);
    for (const id of ids) await deps.journaliser(userId, id, "supprime", { autoliste: liste.nom });
    if (!(await retirer())) return false;
    await poser(deps, liste);
    return true;
  });
}

/** Supprime la liste : ses posts posés à venir partent d'abord à la corbeille (jamais les publiés). */
export async function supprimerAutoliste(
  deps: DepsMaterialiser, userId: string, autolisteId: number, supprimer: () => Promise<boolean>,
): Promise<boolean> {
  return enSerie(autolisteId, async () => {
    const liste = await deps.liste(userId, autolisteId);
    if (!liste) return false;
    const ids = await deps.supprimerFuturs(userId, autolisteId, deps.maintenant());
    for (const id of ids) await deps.journaliser(userId, id, "supprime", { autoliste: liste.nom });
    return supprimer();
  });
}

/** Le passage du planificateur : chaque liste active, une erreur n'arrête pas les autres. */
export async function materialiserTout(deps: DepsMaterialiser): Promise<{ listes: number; poses: number; erreurs: number }> {
  let poses = 0, erreurs = 0;
  const listes = await deps.listesActives();
  for (const l of listes) {
    try {
      // Relue sous le verrou : une modification passée entre-temps fait foi.
      const b = await enSerie(l.id, async () => {
        const fraiche = await deps.liste(l.userId, l.id);
        return fraiche ? poser(deps, fraiche) : null;
      });
      poses += b?.poses ?? 0;
    } catch (e: any) {
      erreurs++;
      console.error(`[autolistes] liste ${l.id} :`, e?.message ?? e);
    }
  }
  return { listes: listes.length, poses, erreurs };
}
