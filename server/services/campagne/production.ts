// Production d'un post de campagne — partie PURE (aucun accès base).
//
// Les tâches de production DÉRIVENT de chaque post (ligne `content`) : leurs étapes
// dépendent du format du post, et chacune est planifiée à rebours depuis la date de
// publication (`content.scheduled_for`). Avant oct. 2026, elles venaient du texte libre
// généré par le modèle (`campaigns.generated_tasks`), découpé en sous-tâches anglaises
// sans lien avec les posts (`tasks.content_id` jamais rempli) : des posts tombaient à
// échéance sans aucune tâche de production dans le planning.
import { formatDate, addDays } from "../../utils/dateUtils";

export type GenreProduction = "image" | "texte" | "carrousel" | "video" | "story" | "long";

export interface PostAProduire {
  id?: number;
  title?: string | null;
  postFormat?: string | null;
  contentType?: string | null;
  autoPost?: boolean | null;
}

export interface EtapeProduction {
  /** Libellé de l'étape, sans le titre du post : sert de clé d'idempotence. */
  cle: string;
  titre: string;
  description: string;
  /** Jours avant la publication (0 = le jour même). */
  joursAvant: number;
  /** Minutes. */
  duree: number;
  energie: string;
  /** La tâche « Publier » (posts sans publication automatique). */
  publication: boolean;
}

const VIDEO = ["feed_video", "reel", "short"];
const LONG = ["article", "email", "newsletter", "blog"];

export function genreProduction(post: PostAProduire): GenreProduction {
  const pf = (post.postFormat || "").trim().toLowerCase();
  const ct = (post.contentType || "").trim().toLowerCase();
  if (pf === "carousel" || ct === "carousel") return "carrousel";
  if (VIDEO.includes(pf)) return "video";
  if (LONG.includes(ct)) return "long";
  if (pf === "story" || ct === "story") return "story";
  if (pf === "text") return "texte";
  return "image";
}

type Modele = Omit<EtapeProduction, "titre" | "publication">;

const RELIRE: Modele = {
  cle: "Relire et valider le post", joursAvant: 1, duree: 15, energie: "execution",
  description: "Relire le texte et le visuel une dernière fois, vérifier la plateforme et l'heure de publication.",
};

const MODELES: Record<GenreProduction, Modele[]> = {
  image: [
    { cle: "Rédiger le texte", joursAvant: 2, duree: 30, energie: "creative", description: "Écrire le texte du post à partir de l'angle prévu." },
    { cle: "Préparer le visuel", joursAvant: 1, duree: 45, energie: "creative", description: "Créer ou choisir le visuel qui accompagne le post." },
    RELIRE,
  ],
  texte: [
    { cle: "Rédiger le texte", joursAvant: 2, duree: 30, energie: "creative", description: "Écrire le texte du post à partir de l'angle prévu." },
    RELIRE,
  ],
  carrousel: [
    { cle: "Structurer le carrousel", joursAvant: 3, duree: 30, energie: "deep_work", description: "Définir l'accroche, le message clé et le découpage des slides." },
    { cle: "Rédiger les slides", joursAvant: 2, duree: 45, energie: "creative", description: "Écrire le texte de chaque slide et la légende du post." },
    { cle: "Designer les slides", joursAvant: 1, duree: 60, energie: "creative", description: "Mettre les slides en forme visuellement." },
    RELIRE,
  ],
  video: [
    { cle: "Écrire le script", joursAvant: 4, duree: 45, energie: "deep_work", description: "Écrire le script et l'accroche des premières secondes." },
    { cle: "Tourner", joursAvant: 3, duree: 60, energie: "creative", description: "Filmer ou enregistrer la vidéo." },
    { cle: "Monter", joursAvant: 2, duree: 60, energie: "creative", description: "Monter la vidéo, ajouter sous-titres et son." },
    RELIRE,
  ],
  story: [
    { cle: "Préparer la story", joursAvant: 1, duree: 30, energie: "creative", description: "Préparer le visuel ou la vidéo de la story et son texte." },
    RELIRE,
  ],
  long: [
    { cle: "Construire le plan", joursAvant: 4, duree: 30, energie: "deep_work", description: "Poser les idées clés et le plan." },
    { cle: "Rédiger le texte", joursAvant: 3, duree: 90, energie: "deep_work", description: "Écrire le texte complet." },
    { cle: "Mettre en forme", joursAvant: 2, duree: 30, energie: "creative", description: "Relire, mettre en forme, ajouter liens et visuels." },
    RELIRE,
  ],
};

const PUBLIER: Modele = {
  cle: "Publier", joursAvant: 0, duree: 15, energie: "execution",
  description: "Publier le post à l'heure prévue (il ne part pas automatiquement).",
};

const TITRE_MAX = 140;

function titrePost(post: PostAProduire, cle: string): string {
  const t = (post.title || "").replace(/\s+/g, " ").trim() || "post sans titre";
  const place = TITRE_MAX - cle.length - 3;
  return t.length > place ? t.slice(0, Math.max(1, place - 1)) + "…" : t;
}

/**
 * Étapes de production d'un post, de la plus lointaine à la plus proche de la publication.
 * Pas de tâche « Publier » quand le post part tout seul (`autoPost`).
 */
export function etapesProductionPourPost(post: PostAProduire): EtapeProduction[] {
  const modeles = [...MODELES[genreProduction(post)]];
  if (post.autoPost !== true) modeles.push(PUBLIER);
  return modeles.map((m) => ({
    ...m,
    titre: `${m.cle} — ${titrePost(post, m.cle)}`,
    publication: m === PUBLIER,
  }));
}

const plusJours = (ds: string, n: number) => formatDate(addDays(new Date(ds + "T00:00:00"), n));

/**
 * Jour d'une étape : la cible (J-n), reculée au jour travaillé précédent ; jamais avant
 * aujourd'hui ni avant `plancher` (l'étape précédente du même post) ; jamais après le post.
 * Sans jour travaillé entre le plancher et la cible, on avance jusqu'au jour du post au
 * plus tard ; sans jour travaillé du tout, la cible bornée est gardée (l'étape n'est
 * jamais abandonnée : le post a une échéance).
 */
export function jourDeProduction({ cible, jourPost, aujourdhui, estTravaille, plancher }: {
  cible: string; jourPost: string; aujourdhui: string; estTravaille: (d: string) => boolean; plancher?: string;
}): string {
  const bas = plancher && plancher > aujourdhui ? plancher : aujourdhui;
  let c = cible < bas ? bas : cible;
  if (c > jourPost) c = jourPost;
  for (let d = c; d >= bas; d = plusJours(d, -1)) if (estTravaille(d)) return d;
  for (let d = plusJours(c, 1); d <= jourPost; d = plusJours(d, 1)) if (estTravaille(d)) return d;
  return c;
}

// ─── Posts concernés ─────────────────────────────────────────────────────────

const STATUTS_PUBLIES_OU_EN_COURS = ["posted", "uploading", "processing", "posting"];

/** Post à venir (aujourd'hui compris), ni publié ni en cours de publication. */
export function postAProduire(
  c: { scheduledFor?: Date | string | null; publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null },
  aujourdhui: string,
): boolean {
  if (!c.scheduledFor) return false;
  if (c.publishedAt !== null && c.publishedAt !== undefined) return false;
  if (STATUTS_PUBLIES_OU_EN_COURS.includes((c.postStatus || "").trim().toLowerCase())) return false;
  if ((c.contentStatus || "").trim().toLowerCase() === "published") return false;
  return jourDuPost(c.scheduledFor) >= aujourdhui;
}

export function jourDuPost(scheduledFor: Date | string): string {
  return formatDate(new Date(scheduledFor));
}

// ─── Tâches générées par le modèle (campaigns.generated_tasks) ───────────────

const MOTS_CONTENU = /publish|publier|\bposts?\b(?!-)|write|rédig|écri|carousel|carrousel|\breels?\b|article|newsletter|caption|légende|contenu|content|vid[eé]o|\bstor(y|ies)\b|script|visuel|tourn/i;

/** Tâche de contenu : elle est désormais produite depuis les posts, plus depuis ce texte. */
export function estTacheContenuGeneree(t: { title?: string | null; type?: string | null }): boolean {
  if ((t.type || "").toLowerCase() === "content") return true;
  return MOTS_CONTENU.test(t.title || "");
}

const MOTS_PROSPECTION = /prospect|outreach|\bdms?\b|messages? priv|messages? direct|cold (e-?mail|message|call)|démarch|reach out|contacter|connection request|demandes? de connexion|invitations? linkedin|\bleads?\b/i;

/** Prospection : automatisée par le pipeline de prospection, jamais une tâche manuelle. */
export function estTacheProspection(t: { title?: string | null; type?: string | null }): boolean {
  if ((t.type || "").toLowerCase() === "outreach") return true;
  return MOTS_PROSPECTION.test(t.title || "");
}

// ─── Format libre du plan de contenu → content.post_format ───────────────────

export function mapFormatToPostFormat(format: string | null | undefined): string {
  const f = (format || "").toLowerCase();
  if (f.includes("carousel") || f.includes("carrousel") || f.includes("slides")) return "carousel";
  if (f.includes("reel")) return "reel";
  if (f.includes("short") || f.includes("tiktok")) return "short";
  if (f.includes("story") || f.includes("stories")) return "story";
  if (f.includes("video") || f.includes("vidéo")) return "feed_video";
  if (/\btext|texte|article|newsletter|e-?mail|blog|thread/.test(f)) return "text";
  return "feed_image";
}

// ─── Migration des anciennes sous-tâches anglaises ───────────────────────────

/** Préfixes produits par l'ancien `decomposeContentTask` (supprimé en oct. 2026). */
export const ANCIENS_PREFIXES_PRODUCTION = [
  "Script — ", "Shoot/record — ", "Edit & caption — ", "Schedule & publish — ",
  "Outline — ", "Write — ", "Edit & format — ", "Schedule — ",
  "Angle & structure — ", "Write copy — ", "Design slides — ", "Publish — ",
];

export function estAncienneSousTacheContenu(titre: string | null | undefined): boolean {
  const t = titre || "";
  return ANCIENS_PREFIXES_PRODUCTION.some((p) => t.startsWith(p));
}

/**
 * Dernier jour où une étape de production peut être faite : le jour du post pour
 * « Publier », la veille pour toutes les autres (le jour même, elles risqueraient de
 * tomber après l'heure de publication).
 */
export function echeanceTache(titre: string | null | undefined, jourPost: string | null | undefined): string | null {
  if (!jourPost) return null;
  if ((titre ?? "").startsWith("Publier —")) return jourPost;
  const [y, m, d] = jourPost.split("-").map(Number);
  return formatDate(addDays(new Date(y, m - 1, d), -1));
}

// ─── Ordre des étapes d'un post (invariant du planning) ──────────────────────
//
// Constaté en prod le 9 oct. 2026 : « Relire et valider » le 9, « Rédiger le texte » le 12
// et « Préparer le visuel » le 14 après la publication — pour le MÊME post. Le placement
// initial était juste ; les re-tassages successifs (débordement reporté au lendemain, report
// des tâches en retard) déplaçaient chaque étape sans rien savoir des autres.
//
// L'invariant, rétabli à chaque re-tassage (storage.fixOverlappingTasks) :
//   1. les étapes d'un post se suivent dans l'ordre de `etapesProductionPourPost` ;
//   2. une étape de préparation est faite au plus tard la veille (jour travaillé) du post ;
//   3. aucune étape n'est dans le passé ;
//   4. « Publier » est le jour du post, à l'heure du post.

/** Rang d'une étape dans la production de SON post (0 = la première), ou -1. */
export function rangEtape(post: PostAProduire, titre: string | null | undefined): number {
  const t = titre ?? "";
  return etapesProductionPourPost({ ...post, autoPost: false }).findIndex((e) => t.startsWith(`${e.cle} — `));
}

export const estTachePublier = (titre: string | null | undefined) => (titre ?? "").startsWith("Publier —");

export interface EtapePlacee {
  id: number;
  title: string | null;
  scheduledDate: string | null;
  completed?: boolean | null;
}

/**
 * Jours corrigés des étapes NON FAITES d'un post, dans le respect de l'invariant. Ne renvoie
 * que les étapes à déplacer : une étape déjà à un jour admissible reste où elle est (le
 * planning ne bouge pas sans raison). PURE.
 */
export function joursEtapesEnOrdre({ post, etapes, jourPost, aujourdhui, estTravaille }: {
  post: PostAProduire;
  etapes: EtapePlacee[];
  jourPost: string;
  aujourdhui: string;
  estTravaille: (d: string) => boolean;
}): Map<number, string> {
  const deplacements = new Map<number, string>();
  if (jourPost < aujourdhui) return deplacements;

  // Veille travaillée du post ; si elle est déjà passée, le jour même (avant l'heure du post).
  let veille = plusJours(jourPost, -1);
  while (veille >= aujourdhui && !estTravaille(veille)) veille = plusJours(veille, -1);
  const echeance = veille >= aujourdhui ? veille : jourPost;

  const ordonnees = etapes
    .map((e) => ({ e, rang: rangEtape(post, e.title) }))
    .filter((x) => x.rang >= 0)
    .sort((a, b) => a.rang - b.rang || a.e.id - b.e.id);

  let plancher = aujourdhui;
  for (const { e } of ordonnees) {
    if (e.completed) continue; // une étape faite ne contraint plus rien
    if (estTachePublier(e.title)) {
      if (e.scheduledDate !== jourPost) deplacements.set(e.id, jourPost);
      continue;
    }
    const actuel = e.scheduledDate ?? "";
    let jour = actuel;
    if (!jour || jour < plancher) jour = plancher;
    if (jour > echeance) jour = echeance < plancher ? plancher : echeance;
    if (!estTravaille(jour)) {
      // Jour travaillé le plus proche dans [plancher, echeance] : d'abord en arrière, puis en avant.
      let d = jour;
      while (d > plancher && !estTravaille(d)) d = plusJours(d, -1);
      if (!estTravaille(d)) {
        d = jour;
        while (d < echeance && !estTravaille(d)) d = plusJours(d, 1);
      }
      if (estTravaille(d)) jour = d;
    }
    if (jour !== actuel) deplacements.set(e.id, jour);
    plancher = jour;
  }
  return deplacements;
}
