// shared/bibliotheque.ts — Bibliothèque (lot 3, inspiré de Metricool « savedTexts » et
// « library posts ») : textes enregistrés réutilisables et posts modèles. Règles pures, sans base.
import { copiePourDuplication } from "./gestion-posts";

export const TITRE_TEXTE_MAX = 120;
export const TEXTE_ENREGISTRE_MAX = 5000;
export const NOM_MODELE_MAX = 120;

const idPositif = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
};

/** Projet facultatif : absent → undefined ; null → aucun ; id lisible → id ; sinon "invalide". */
function lireProjet(v: unknown): number | null | undefined | "invalide" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return idPositif(v) ?? "invalide";
}

export type TexteEnregistreSaisi = { titre: string; texte: string; projectId: number | null };

/**
 * Le corps d'un texte enregistré, validé. `partiel` (modification) : seuls les champs présents
 * sont lus, au moins un. null : illisible (titre vide ou > 120, texte vide ou > 5000, projet illisible).
 */
export function lireTexteEnregistre(body: unknown, partiel = false): Partial<TexteEnregistreSaisi> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sortie: Partial<TexteEnregistreSaisi> = {};
  if (b.titre !== undefined || !partiel) {
    if (typeof b.titre !== "string") return null;
    const titre = b.titre.trim();
    if (!titre || titre.length > TITRE_TEXTE_MAX) return null;
    sortie.titre = titre;
  }
  if (b.texte !== undefined || !partiel) {
    if (typeof b.texte !== "string") return null;
    // Le texte garde ses espaces internes et ses retours à la ligne : on ne rogne que les bords.
    const texte = b.texte.replace(/^\s+|\s+$/g, "");
    if (!texte || texte.length > TEXTE_ENREGISTRE_MAX) return null;
    sortie.texte = texte;
  }
  const p = lireProjet(b.projectId);
  if (p === "invalide") return null;
  if (p !== undefined) sortie.projectId = p;
  else if (!partiel) sortie.projectId = null;
  if (partiel && Object.keys(sortie).length === 0) return null;
  return sortie;
}

/** Nom d'un modèle, rogné ; null s'il est vide, pas une chaîne, ou trop long. */
export function lireNomModele(body: unknown): string | null {
  const n = (body as any)?.nom;
  if (typeof n !== "string") return null;
  const s = n.trim();
  return s && s.length <= NOM_MODELE_MAX ? s : null;
}

/**
 * Ce qu'un modèle garde d'un post : le texte de chaque réseau (le post et ses frères d'un même
 * envoi multi-réseaux), les médias, le format et les options de publication. Jamais la date,
 * le compte, l'état de publication, la campagne ni la tâche d'origine.
 */
export const CHAMPS_MODELE = [
  "platform", "title", "contentType", "pillar", "goal", "intent", "angle", "formatCreatif",
  "mediaIds", "mediaUrl", "mediaFileName", "videoMeta", "postFormat",
  "premierCommentaire", "couvertureUrl", "couvertureOffsetMs", "texteAlternatif", "collaborateurs",
  "reelDansLeFil", "nomAudio", "linkedinDocument",
] as const;

export type ContenuModele = { textes: Record<string, string> } & Record<string, any>;

const reseau = (p: unknown) => String(p ?? "").trim().toLowerCase();

export function contenuDeModele(post: Record<string, any>, freres: Array<Record<string, any>> = []): ContenuModele {
  // Même constructeur que « Dupliquer » : les mêmes champs sont copiés, de la même façon.
  const copie = copiePourDuplication(post, { projectId: null, scheduledFor: null });
  const contenu: ContenuModele = { textes: {} };
  for (const k of CHAMPS_MODELE) contenu[k] = copie[k] ?? null;
  contenu.platform = reseau(post.platform);
  for (const f of freres) {
    if (f.supprimeLe || f.userId !== post.userId) continue;
    const r = reseau(f.platform);
    if (r && typeof f.body === "string") contenu.textes[r] = f.body;
  }
  // Le texte du post lui-même l'emporte sur celui d'un frère du même réseau.
  contenu.textes[contenu.platform] = String(post.body ?? "");
  return contenu;
}

/** Les réseaux pour lesquels un modèle a un texte. */
export function reseauxDuModele(contenu: ContenuModele): string[] {
  return Object.keys(contenu?.textes ?? {});
}

export type Utilisation = { projectId: number | null; scheduledFor: Date | null; platform: string | null };

/** Le corps de « Utiliser ce modèle » : projectId (null = sans marque), date et réseau facultatifs. */
export function lireUtilisation(body: unknown): Utilisation | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const p = lireProjet(b.projectId);
  if (p === "invalide") return null;
  let scheduledFor: Date | null = null;
  if (b.scheduledFor !== undefined && b.scheduledFor !== null && b.scheduledFor !== "") {
    const d = new Date(b.scheduledFor as any);
    if (Number.isNaN(d.getTime())) return null;
    scheduledFor = d;
  }
  let platform: string | null = null;
  if (b.platform !== undefined && b.platform !== null && b.platform !== "") {
    if (typeof b.platform !== "string") return null;
    platform = reseau(b.platform);
  }
  return { projectId: p ?? null, scheduledFor, platform };
}

/**
 * La ligne de contenu créée depuis un modèle : un brouillon, jamais programmé (autoPost false),
 * sans compte. null si le réseau demandé n'a pas de texte dans le modèle.
 */
export function postDepuisModele(
  contenu: ContenuModele,
  userId: string,
  u: Utilisation,
): Record<string, any> | null {
  const platform = u.platform ?? reseau(contenu.platform);
  const textes = contenu?.textes ?? {};
  if (!(platform in textes)) return null;
  const source: Record<string, any> = { ...contenu, userId, platform, body: textes[platform], contentStatus: "draft" };
  delete source.textes;
  const row = copiePourDuplication(source, { projectId: u.projectId, scheduledFor: u.scheduledFor });
  // Champs obligatoires de `content` : un modèle ancien ou incomplet garde une ligne valide.
  row.title = row.title || String(textes[platform]).slice(0, 80) || "Post";
  row.contentType = row.contentType || "post";
  row.pillar = row.pillar || "general";
  row.goal = row.goal || "engagement";
  return row;
}

/** Recherche par nom (ou titre), sans casse ni accents. */
export function filtrerParNom<T>(liste: T[], q: string, nom: (x: T) => string): T[] {
  const plat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const cle = plat(q ?? "");
  if (!cle) return liste;
  return liste.filter((x) => plat(nom(x) ?? "").includes(cle));
}

/**
 * Insère `ajout` à la place de la sélection [debut, fin) de `valeur` (au curseur quand debut = fin ;
 * à la fin quand la position est inconnue). Rend la nouvelle valeur et la position du curseur après.
 */
export function insererAuCurseur(
  valeur: string,
  ajout: string,
  debut?: number | null,
  fin?: number | null,
): { valeur: string; curseur: number } {
  const v = valeur ?? "";
  const borne = (n: number) => Math.max(0, Math.min(v.length, n));
  const d = debut == null || !Number.isFinite(debut) ? v.length : borne(debut);
  const f = fin == null || !Number.isFinite(fin) ? d : Math.max(d, borne(fin));
  const nouvelle = v.slice(0, d) + ajout + v.slice(f);
  return { valeur: nouvelle, curseur: d + ajout.length };
}
