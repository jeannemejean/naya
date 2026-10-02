// Rejet d'une campagne générée.
//
// Cette partie du fichier est PURE : aucun accès base, aucun appel modèle. Ce qui
// DÉCIDE quoi garder est ici et se teste sans infrastructure ; l'orchestration est en
// bas et ne décide rien.

/** Salience d'un rejet. Le défaut de la colonne est 0,5 ; un rejet explicitement
 *  formulé par l'utilisatrice est un signal plus fort qu'une observation déduite. */
export const SALIENCE_REJET = 0.8;

export interface ContenuCandidat {
  id: number;
  publishedAt: Date | null;
  postStatus: string | null;
  contentStatus: string | null;
}

export interface TacheCandidate {
  id: number;
  completed: boolean;
}

export interface Tri {
  /** Identifiants à DÉTACHER (campaignId → null) : ils survivent au rejet. */
  gardes: number[];
  /** Identifiants à supprimer avec la campagne. */
  partants: number[];
}

/**
 * Un contenu est considéré comme publié dès qu'UN SEUL signal est allumé.
 *
 * `content` porte quatre champs qui peuvent se contredire : une carte glissée en
 * « publié » dans le pipeline n'est pas forcément partie sur une plateforme, et un post
 * auto-publié n'a pas forcément vu son `contentStatus` suivre. On ne cherche pas à
 * arbitrer entre eux : on garde dès que l'un dit « publié ».
 *
 * Le sens prudent est le bon, et il est assumé : garder quelque chose en trop coûte de
 * l'encombrement ; supprimer quelque chose de publié falsifie l'historique de
 * l'utilisatrice.
 */
export function contenuEstPublie(c: ContenuCandidat): boolean {
  if (c.publishedAt !== null && c.publishedAt !== undefined) return true;
  if ((c.postStatus || "").trim().toLowerCase() === "posted") return true;
  if ((c.contentStatus || "").trim().toLowerCase() === "published") return true;
  return false;
}

export function tacheEstFaite(t: TacheCandidate): boolean {
  return t.completed === true;
}

export function trierContenus(cs: ContenuCandidat[]): Tri {
  const gardes: number[] = [];
  const partants: number[] = [];
  for (const c of cs) (contenuEstPublie(c) ? gardes : partants).push(c.id);
  return { gardes, partants };
}

export function trierTaches(ts: TacheCandidate[]): Tri {
  const gardes: number[] = [];
  const partants: number[] = [];
  for (const t of ts) (tacheEstFaite(t) ? gardes : partants).push(t.id);
  return { gardes, partants };
}

/**
 * Le texte de la préférence déposée en mémoire.
 *
 * Elle doit se tenir SEULE : une entrée de mémoire est relue des mois plus tard, mêlée
 * à d'autres, hors de tout contexte. « Je ne veux pas ça » y serait illisible — d'où le
 * rappel de ce qui a été rejeté, et pas seulement de la raison.
 *
 * Rend `null` quand la raison est vide : pas de préférence sans raison (Décision 4 du
 * spec). C'est l'appelant qui en informe l'utilisatrice.
 */
export function construirePreference(input: {
  campagne: { name: string | null; objective: string | null; coreMessage: string | null };
  raison: string;
}): string | null {
  const raison = (input.raison || "").trim();
  if (!raison) return null;

  const { name, objective, coreMessage } = input.campagne;
  const nom = (name || "").trim();
  const lignes: string[] = [
    nom
      ? `Campagne rejetée pour cette marque : « ${nom} ».`
      : "Une campagne générée pour cette marque a été rejetée.",
  ];
  const obj = (objective || "").trim();
  if (obj) lignes.push(`Son objectif était : ${obj}.`);
  const msg = (coreMessage || "").trim();
  if (msg) lignes.push(`Son message central était : ${msg}.`);
  const raisonAvecPoint = raison.endsWith(".") ? raison : raison + ".";
  lignes.push(`Ce qui n'allait pas, dans les mots de l'utilisatrice : ${raisonAvecPoint}`);
  return lignes.join(" ");
}

// ════════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION — tout ce qui suit DÉCIDE d'écrire en base. Rien au-dessus de cette
// ligne n'est touché : les fonctions pures ci-dessus sont verrouillées (tâche 1,
// relues et renforcées par mutation).
// ════════════════════════════════════════════════════════════════════════════════

import { and, eq, inArray, or } from "drizzle-orm";
import { content, tasks, campaigns, projects, memoryEntries, prospectionCampaigns } from "@shared/schema";
import { db } from "../../db";
import { embedText } from "../memory/embed";
import { storage } from "../../storage";

/**
 * Levée quand la campagne n'existe pas, ou n'appartient pas à l'utilisatrice — les
 * deux cas sont indiscernables depuis l'extérieur, et c'est volontaire (règle 13 du
 * brief : jamais même vue). Motif repris de `ReponseIllisible`
 * (`server/services/content-import/import.ts`), reconnue par `instanceof` dans
 * `server/routes.ts` pour rendre un code HTTP précis — jamais en lisant son message.
 *
 * Sans classe dédiée, l'appelant devrait reconnaître un message français pour
 * distinguer un 404 d'un 500 : une reformulation future casserait alors ce mapping
 * en silence. Cas concret : l'utilisatrice ouvre la campagne dans deux onglets, la
 * supprime depuis le premier, puis clique « rejeter » depuis le second — elle doit
 * lire que la campagne n'existe déjà plus, pas une erreur qui ressemble à une panne.
 */
export class CampagneIntrouvable extends Error {
  constructor(campaignId: number) {
    super(`Campagne ${campaignId} introuvable pour cet utilisateur`);
  }
}

export interface ResultatRejet {
  contenusDetaches: number;
  contenusSupprimes: number;
  tachesDetachees: number;
  tachesSupprimees: number;
  preferenceEcrite: boolean;
  /** La préférence est écrite mais NON vectorisée : invisible à la récupération
   *  sémantique, et rien ne la rattrapera. Voir Décision 7 du spec. */
  preferenceSansEmbedding: boolean;
  articulationsRompues: Array<{ campagneId: number; campagneNom: string; marque: string }>;
  /** Campagne(s) de prospection emportées par ce rejet — même cascade complète que
   *  `storage.deleteCampaign` (séquences supprimées, prospects archivés). Le lien se
   *  lit dans les deux sens : `campaigns.linkedProspectionCampaignId` ET
   *  `prospectionCampaigns.linkedCampaignId`. */
  prospectionSupprimee: Array<{ id: number; name: string }>;
}

/**
 * Exécute le rejet d'une campagne générée, en base.
 *
 * L'ORDRE N'EST PAS ARBITRAIRE (voir le brief de ce chantier) :
 *
 *   1. détacher les contenus/tâches GARDÉS (campaignId → null)
 *   2. supprimer les contenus/tâches PARTANTS
 *   3. écrire la préférence (si une raison a été donnée)
 *   4. supprimer la (ou les) campagne(s) de prospection liée(s), avec LEUR propre
 *      cascade (prospects archivés, séquences supprimées) — voir
 *      `storage.deleteProspectionCampaign`
 *   5. supprimer la campagne
 *
 * `content.campaign_id` et `tasks.campaign_id` sont en `NO ACTION` : supprimer la
 * campagne tant qu'une seule ligne la référence encore échoue. Dans cet ordre précis,
 * plus aucune ligne ne référence la campagne au moment où elle est supprimée.
 *
 * L'ancien bouton Supprimer cascadait vers la prospection liée (`storage.deleteCampaign`
 * → `storage.deleteProspectionCampaign`) ; rejeter une campagne doit faire pareil — une
 * campagne de prospection vivante, avec ses séquences, pointant vers une campagne
 * marketing supprimée serait une incohérence que plus rien ne rattraperait. L'appel se
 * fait avec `tx` : `deleteProspectionCampaign` ouvre normalement SA PROPRE
 * `db.transaction`, ce qui imbriquerait deux transactions si on l'appelait tel quel
 * depuis l'intérieur de celle-ci. Passer `tx` comme exécuteur lui fait exécuter sa
 * cascade DANS la transaction déjà ouverte, sans en ouvrir une seconde — même motif que
 * `jaEnTransaction` dans `services/result-capture/observation-writer.ts`. Les appelants
 * qui ne passent pas d'exécuteur (dont `storage.deleteCampaign`) ne sont pas affectés :
 * `deleteProspectionCampaign` ouvre alors sa transaction comme avant.
 *
 * L'embedding de la préférence est calculé AVANT d'ouvrir la transaction : tenir une
 * transaction ouverte pendant un appel réseau verrouillerait des lignes pendant des
 * secondes. `embedText` est best-effort — `null` ou une levée produisent le même
 * résultat (`preferenceSansEmbedding: true`), jamais un rejet en échec.
 *
 * Les opérations ci-dessus (plus la lecture des articulations rompues, qui doit
 * précéder la suppression pour ne pas perdre l'information) vivent dans UNE SEULE
 * `db.transaction` : si quoi que ce soit échoue en cours de route — y compris dans la
 * cascade de prospection — rien n'est validé : ni détachement, ni suppression, ni
 * préférence, ni cascade de prospection.
 */
export async function rejeterCampagne(input: {
  userId: string;
  campaignId: number;
  raison: string;
}): Promise<ResultatRejet> {
  const { userId, campaignId, raison } = input;

  // La clause porte sur userId ET id : une campagne qui n'appartient pas à
  // l'utilisatrice n'est jamais touchée, jamais même vue.
  const [campagne] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      objective: campaigns.objective,
      coreMessage: campaigns.coreMessage,
      projectId: campaigns.projectId,
      linkedProspectionCampaignId: campaigns.linkedProspectionCampaignId,
    })
    .from(campaigns)
    .where(and(eq(campaigns.userId, userId), eq(campaigns.id, campaignId)));

  if (!campagne) {
    throw new CampagneIntrouvable(campaignId);
  }

  // Lectures seules, hors transaction : elles ne décident que du tri, ne mutent rien.
  const contenus = await db
    .select({
      id: content.id,
      publishedAt: content.publishedAt,
      postStatus: content.postStatus,
      contentStatus: content.contentStatus,
    })
    .from(content)
    .where(and(eq(content.userId, userId), eq(content.campaignId, campaignId)));

  const tachesBrutes = await db
    .select({ id: tasks.id, completed: tasks.completed })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.campaignId, campaignId)));

  // Campagne(s) de prospection liée(s) — DANS LES DEUX SENS, même motif que
  // `storage.deleteCampaign` : `campaigns.linkedProspectionCampaignId` (le lien direct,
  // porté par CETTE campagne) OU `prospectionCampaigns.linkedCampaignId` (le lien
  // inverse, porté par la campagne de prospection). Une seule requête couvre les deux :
  // la condition sur l'id direct n'est ajoutée que si `campagne.linkedProspectionCampaignId`
  // est renseigné — sinon seul le lien inverse est interrogé.
  const conditionsProspection = [eq(prospectionCampaigns.linkedCampaignId, campaignId)];
  if (campagne.linkedProspectionCampaignId) {
    conditionsProspection.push(eq(prospectionCampaigns.id, campagne.linkedProspectionCampaignId));
  }
  const prospectionLiee = await db
    .select({ id: prospectionCampaigns.id, name: prospectionCampaigns.name })
    .from(prospectionCampaigns)
    .where(and(eq(prospectionCampaigns.userId, userId), or(...conditionsProspection)));

  const triContenus = trierContenus(contenus);
  const triTaches = trierTaches(tachesBrutes);

  // Préférence : construite (pure), puis vectorisée AVANT la transaction.
  const texte = construirePreference({ campagne, raison });
  let embedding: number[] | null = null;
  let preferenceSansEmbedding = false;
  if (texte) {
    try {
      embedding = await embedText(texte);
    } catch {
      embedding = null;
    }
    if (!embedding) preferenceSansEmbedding = true;
  }

  return db.transaction(async (tx) => {
    // Relevées AVANT la suppression de la campagne : la contrainte est en SET NULL
    // (rien ne casse), mais l'information disparaît si on ne la lit pas maintenant —
    // l'écran de confirmation en a besoin.
    const articulations = await tx
      .select({
        campagneId: campaigns.id,
        campagneNom: campaigns.name,
        marque: projects.name,
      })
      .from(campaigns)
      .leftJoin(projects, eq(campaigns.projectId, projects.id))
      // `userId` ici aussi, par discipline : rien ne garantit en base qu'une
      // campagne ne puisse être articulée qu'avec celles du même compte, c'est
      // `articulationsDisponibles` (brand-links/articulation.ts) qui tient cet
      // invariant en amont, pas une contrainte. Défense en profondeur, pas une
      // fuite corrigée.
      .where(and(eq(campaigns.userId, userId), eq(campaigns.articuleAvecCampaignId, campaignId)));

    const articulationsRompues = articulations.map((a) => ({
      campagneId: a.campagneId,
      campagneNom: a.campagneNom,
      marque: a.marque ?? "",
    }));

    // 1. Détacher les gardés.
    if (triContenus.gardes.length > 0) {
      await tx.update(content).set({ campaignId: null }).where(inArray(content.id, triContenus.gardes));
    }
    if (triTaches.gardes.length > 0) {
      await tx.update(tasks).set({ campaignId: null }).where(inArray(tasks.id, triTaches.gardes));
    }

    // 2. Supprimer les partants.
    if (triContenus.partants.length > 0) {
      await tx.delete(content).where(inArray(content.id, triContenus.partants));
    }
    if (triTaches.partants.length > 0) {
      await tx.delete(tasks).where(inArray(tasks.id, triTaches.partants));
    }

    // 3. Écrire la préférence — jamais sans raison (Décision 4 du spec).
    let preferenceEcrite = false;
    if (texte) {
      await tx.insert(memoryEntries).values({
        userId,
        projectId: campagne.projectId,
        fil: "cap",
        entryType: "préférence",
        content: texte,
        embedding,
        salience: SALIENCE_REJET,
      });
      preferenceEcrite = true;
    }

    // 4. Supprimer la ou les campagnes de prospection liées, cascade complète incluse
    //    (prospects archivés, séquences supprimées) — DANS cette même transaction (`tx`
    //    en exécuteur : pas de transaction imbriquée, voir le commentaire au-dessus).
    for (const p of prospectionLiee) {
      await storage.deleteProspectionCampaign(p.id, userId, tx);
    }

    // 5. Supprimer la campagne — plus aucune ligne ne la référence à cet instant.
    await tx.delete(campaigns).where(and(eq(campaigns.userId, userId), eq(campaigns.id, campaignId)));

    return {
      contenusDetaches: triContenus.gardes.length,
      contenusSupprimes: triContenus.partants.length,
      tachesDetachees: triTaches.gardes.length,
      tachesSupprimees: triTaches.partants.length,
      preferenceEcrite,
      preferenceSansEmbedding,
      articulationsRompues,
      prospectionSupprimee: prospectionLiee.map((p) => ({ id: p.id, name: p.name })),
    };
  });
}
