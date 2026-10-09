// Règles des livrables de tâche — importées par le serveur ET le client.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md

export type LivrableKind = "texte" | "media" | "fichier" | "lien";

// Étape 1 seulement : à l'étape 2, le générateur déclarera le livrable attendu.
const VERBES_PRODUCTION = [
  "photographi", "filme", "enregistr", "rédig", "écri", "list", "crée", "créer",
  "conçoi", "concevoir", "prépar", "dessin", "monte", "capture", "note", "documente",
  "compile", "collect", "rassembl",
];

/** Vrai si le titre commence par un verbe de production (infinitif ou impératif tutoyé). */
export function estTacheDeProduction(titre: string): boolean {
  const premierMot = (titre ?? "")
    .toLowerCase()
    .replace(/^[^a-zà-ÿœæ]+/i, "")
    .split(/[^a-zà-ÿœæ]+/i)[0] ?? "";
  if (!premierMot) return false;
  return VERBES_PRODUCTION.some((v) => premierMot.startsWith(v));
}

export function decisionAuCochage(input: {
  titre: string;
  dejaTerminee: boolean;
  nbLivrables: number;
}): "cocher" | "demander" {
  if (input.dejaTerminee) return "cocher";
  if (input.nbLivrables > 0) return "cocher";
  return estTacheDeProduction(input.titre) ? "demander" : "cocher";
}

const Mo = 1024 * 1024;

export function limiteOctets(kind: "media" | "fichier", mimeType: string): number {
  if (kind === "media" && mimeType.startsWith("video/")) return 200 * Mo;
  return 25 * Mo;
}

const TYPES_FICHIER = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/** Extensions proposées au sélecteur de fichiers (attribut `accept`). */
export const ACCEPT_FICHIER = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

export function typeAccepte(kind: "media" | "fichier", mimeType: string): boolean {
  if (kind === "media") return /^(image|video)\//.test(mimeType);
  return TYPES_FICHIER.has(mimeType);
}

export function lienValide(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function planDeRangement(input: {
  kind: LivrableKind;
  content: string | null | undefined;
}): { mediatheque: boolean; memoire: string | null } {
  const texte = (input.content ?? "").trim();
  return {
    mediatheque: input.kind === "media",
    memoire: texte ? texte : null,
  };
}

export function titreMemoire(taskTitle: string | null | undefined): string {
  const t = (taskTitle ?? "").trim();
  return t ? `Livrable : ${t}` : "Livrable déposé";
}

// ─── Livrable d'une tâche de production de post ─────────────────────────────
//
// Les tâches de production dérivent d'un post (`tasks.content_id`, voir
// server/services/campagne/production.ts) et s'intitulent « <étape> — <titre du post> ».
// Ce que l'on dépose sur l'une d'elles nourrit le post lui-même, selon l'étape : le texte
// devient le texte du post, la photo ou la vidéo y est jointe. Une étape intermédiaire
// (structure, script, rushes) ne touche pas au post : ce n'est pas encore ce qui sera publié.

const ETAPES_TEXTE = [
  "Rédiger le texte", "Rédiger les slides", "Préparer la story", "Mettre en forme",
  "Relire et valider le post", "Publier",
];
const ETAPES_MEDIA = [
  "Préparer le visuel", "Designer les slides", "Monter", "Préparer la story", "Mettre en forme",
  "Relire et valider le post", "Publier",
];

/** Étape de production portée par le titre de la tâche (« Rédiger le texte — … »), ou null. */
export function etapeDeProduction(titreTache: string | null | undefined): string | null {
  const t = (titreTache ?? "").trim();
  const i = t.indexOf(" — ");
  return i > 0 ? t.slice(0, i) : null;
}

export interface EffetSurPost {
  /** Un texte déposé devient le texte du post. */
  texte: boolean;
  /** Une photo ou une vidéo déposée est jointe au post. */
  media: boolean;
}

export function effetSurPost(titreTache: string | null | undefined): EffetSurPost {
  const etape = etapeDeProduction(titreTache);
  return {
    texte: etape != null && ETAPES_TEXTE.includes(etape),
    media: etape != null && ETAPES_MEDIA.includes(etape),
  };
}

/** Un post en cours de publication ou déjà publié ne se modifie plus depuis une tâche. */
export function postModifiable(postStatus: string | null | undefined): boolean {
  return !["posted", "uploading", "processing", "posting"].includes(postStatus ?? "");
}
