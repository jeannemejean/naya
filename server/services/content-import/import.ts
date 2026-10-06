// Orchestration de l'import d'un texte collé — typiquement un calendrier de contenu
// écrit ailleurs — en posts du calendrier éditorial.
//
// Ce fichier DÉCIDE (base, modèle) ; le découpage pur vit dans `./parse.ts` et ne
// contient aucun accès base ni appel modèle.
import { db } from "../../db";
import { and, desc, eq } from "drizzle-orm";
import { content } from "@shared/schema";
import { callClaudeDetailed, CLAUDE_MODELS } from "../claude";
import { normalizeTitle } from "../reading/url";
import {
  PROMPT_EXTRACTION, construireMessageExtraction, parsePostsExtraits,
  resoudreDate, mesurerCouverture, comblerChamps, plateformeMajoritaire,
} from "./parse";

/** Plafond de la réponse du modèle. Large : un calendrier trimestriel extrait fait du volume. */
const MAX_TOKENS_EXTRACTION = 16000;

/**
 * Nombre de contenus récents consultés pour établir la plateforme majoritaire de la
 * marque. La majorité RÉCENTE est plus juste qu'une majorité historique : elle reflète
 * où la marque publie aujourd'hui, pas où elle publiait il y a deux ans.
 */
const CONTENUS_CONSULTES_PLATEFORME = 200;

/** Au-delà de ce rapport, le modèle a réécrit au lieu d'extraire — on le journalise. */
const SEUIL_REECRITURE = 1.2;

/** Levée quand le modèle a répondu quelque chose d'illisible. L'endpoint la traduit en 502. */
export class ReponseIllisible extends Error {
  constructor() { super("le modèle n'a pas rendu de tableau de posts lisible"); }
}

export interface ResultatImport {
  // `body` est nécessaire à la détection de collision du LOT (routes.ts) : la
  // collision cherche une collision d'ANGLE, et l'angle vit dans le corps, pas le
  // titre — voir le commentaire de `detecterCollision` dans
  // `services/brand-links/collision.ts` sur pourquoi un appel modèle compare des
  // CORPS plutôt que des titres ou des embeddings.
  posts: Array<{ id: number; title: string; body: string; scheduledFor: Date | null }>;
  /** Posts écartés parce que leur titre existait déjà dans cette marque, ou en double dans le lot. */
  ignores: number;
  /** Rapport brut, NON borné : peut dépasser 1. L'endpoint le borne pour l'affichage. */
  couverture: number;
  /**
   * `true` quand `couverture` dépasse `SEUIL_REECRITURE` : le modèle a probablement
   * réécrit le texte au lieu de l'extraire. Calculé ici plutôt que relaissé à l'endpoint
   * ou au reçu, pour qu'un seul seuil fasse foi — pas une recopie du nombre magique à
   * deux endroits qui pourrait diverger.
   */
  reecrit: boolean;
  /** La réponse du modèle a été coupée (`max_tokens` ou `length` selon le provider). */
  tronque: boolean;
}

export async function importerTexte(input: {
  userId: string; projectId: number; texte: string;
}): Promise<ResultatImport> {
  const aujourdhui = new Date();

  // `taskKind: "strategic_reasoning"` et NON "extraction" : "extraction" est routé vers
  // Haiku (server/services/ai/types.ts), et c'est le taskKind qui choisit le PROVIDER —
  // le modèle explicite n'est honoré qu'à l'intérieur de ce provider. Les deux doivent
  // désigner le même palier, sinon la contradiction passe inaperçue jusqu'au jour où le
  // routage change.
  const { text: raw, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.smart,
    taskKind: "strategic_reasoning",
    system: PROMPT_EXTRACTION,
    max_tokens: MAX_TOKENS_EXTRACTION,
    userId: input.userId,
    projectId: input.projectId,
    messages: [{ role: "user", content: construireMessageExtraction(input.texte, aujourdhui) }],
  });

  const extraits = parsePostsExtraits(raw);
  // `null` et `[]` sont DEUX réponses différentes, et la distinction est le point : une
  // réponse illisible est une panne, qu'on fait remonter ; un tableau vide est un
  // résultat, qu'on rend tel quel. Confondre les deux ferait passer une panne pour
  // « aucun post trouvé » — un import qui n'a rien compris se présenterait comme un
  // import réussi à zéro post, et rien ne le dirait.
  if (extraits === null) throw new ReponseIllisible();

  // DEUX valeurs, pas une : `assertNotTruncated` (server/services/claude.ts:137)
  // reconnaît "max_tokens" ET "length" — les providers ne nomment pas la troncature de
  // la même façon. Ne tester que la première laisserait `tronque` à faux sous l'autre
  // provider, avec une couverture basse et aucune explication dans le reçu.
  //
  // On ne réutilise pas `assertNotTruncated` ici parce qu'elle LÈVE : une réponse
  // tronquée doit livrer les posts qu'elle a produits, en le disant, pas tout perdre.
  const tronque = stopReason === "max_tokens" || stopReason === "length";
  const couverture = mesurerCouverture(extraits, input.texte);
  const reecrit = couverture > SEUIL_REECRITURE;

  // Plateformes récentes de la marque, pour combler les posts dont le texte ne la dit
  // pas. Un `select` ordinaire plus un calcul pur, pas un GROUP BY (voir
  // `plateformeMajoritaire`).
  const recents = await db
    .select({ platform: content.platform })
    .from(content)
    .where(and(eq(content.userId, input.userId), eq(content.projectId, input.projectId)))
    .orderBy(desc(content.createdAt))
    .limit(CONTENUS_CONSULTES_PLATEFORME);
  const parDefaut = plateformeMajoritaire(recents.map((r) => r.platform));

  // Titres déjà présents dans cette marque. La déduplication porte sur le titre
  // NORMALISÉ (accents, casse, ponctuation) : `normalizeTitle` existe déjà, écrite pour
  // la revue du matin.
  const existants = await db
    .select({ title: content.title })
    .from(content)
    .where(and(eq(content.userId, input.userId), eq(content.projectId, input.projectId)));
  const vus = new Set(existants.map((e) => normalizeTitle(e.title)));

  const aEcrire: Array<typeof content.$inferInsert> = [];
  let ignores = 0;
  for (const post of extraits) {
    const cle = normalizeTitle(post.titre);
    // Le `vus.add` dans la même passe dédoublonne AUSSI à l'intérieur du lot : deux
    // posts homonymes dans le texte collé n'écrivent qu'une ligne.
    if (vus.has(cle)) { ignores += 1; continue; }
    vus.add(cle);
    const { valeurs, deduits } = comblerChamps(post, parDefaut);
    aEcrire.push({
      userId: input.userId,
      projectId: input.projectId,
      title: post.titre,
      body: post.corps,
      platform: valeurs.platform,
      contentType: valeurs.contentType,
      pillar: valeurs.pillar,
      goal: valeurs.goal,
      status: "draft",
      contentStatus: "idea",
      scheduledFor: resoudreDate(post.date, aujourdhui),
      // Un post importé n'est jamais publié seul : la colonne `autoPost` vaut « oui » par
      // défaut, et une date suffirait à le faire partir (incident évité le 6 oct. 2026).
      autoPost: false,
      // `[]` et non `null` : le contenu est bien passé par un relevé de déductions, et
      // ce relevé est vide. `null` signifierait « question sans objet » (voir le
      // commentaire de la colonne dans shared/schema.ts).
      deducedFields: deduits,
    });
  }

  // Une seule transaction pour tout le lot : un échec au dixième post ne laisse pas les
  // neuf premiers dans le calendrier. L'utilisatrice recolle ; elle ne nettoie pas.
  const posts = aEcrire.length === 0 ? [] : await db.transaction(async (tx) => {
    const lignes = await tx.insert(content).values(aEcrire).returning({
      id: content.id, title: content.title, body: content.body, scheduledFor: content.scheduledFor,
    });
    return lignes;
  });

  console.info(
    `[Import] projet ${input.projectId} : ${posts.length} post(s) écrit(s), ` +
    `${ignores} ignoré(s), couverture ${couverture.toFixed(2)}` +
    (tronque ? ", RÉPONSE TRONQUÉE" : "") +
    (reecrit ? ", le modèle a probablement réécrit au lieu d'extraire" : ""),
  );

  return { posts, ignores, couverture, reecrit, tronque };
}
