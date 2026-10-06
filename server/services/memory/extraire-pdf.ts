import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extraction du texte d'un PDF déposé dans le Savoir de Naya.
 * Un PDF scanné (images seules) ne donne pas de texte : on le DIT (`pas_de_texte`)
 * plutôt que de déposer un dossier vide.
 */
export type ResultatExtraction =
  | { statut: "ok"; texte: string }
  | { statut: "pas_un_pdf" | "illisible" | "pas_de_texte" | "trop_de_pages" };

export const SEUIL_TEXTE = 200;

export const MAX_PAGES = 500;
export const DELAI_EXTRACTION_MS = 20_000;

/** Un PDF géant ou pathologique ne doit pas bloquer le serveur : bornes en pages et en temps. */
export async function extraireTextePdf(buffer: Buffer): Promise<ResultatExtraction> {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { statut: "pas_un_pdf" };
  }
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
    if (pdf.numPages > MAX_PAGES) return { statut: "trop_de_pages" };
    const doc = pdf;
    const delai = new Promise<never>((_, rej) => {
      minuteur = setTimeout(() => rej(new Error("delai_extraction")), DELAI_EXTRACTION_MS);
    });
    const r = await Promise.race([extractText(doc, { mergePages: true }), delai]);
    const texte = Array.isArray(r.text) ? r.text.join("\n") : r.text;
    if (texte.replace(/\s/g, "").length < SEUIL_TEXTE) return { statut: "pas_de_texte" };
    return { statut: "ok", texte };
  } catch {
    return { statut: "illisible" };
  } finally {
    if (minuteur) clearTimeout(minuteur);
    // unpdf ne détruit que les documents qu'il a ouverts lui-même : sans cela, fuite mémoire.
    await pdf?.loadingTask.destroy().catch(() => {});
  }
}

/** Titre d'un dossier = nom du fichier sans `.pdf`, sans chemin, trimé, ≤ 200 caractères. */
export function titreDepuisNomFichier(nom: string): string {
  const base = (nom ?? "").split(/[\\/]/).pop() ?? "";
  // " — " sépare le titre du morceau dans la mémoire : un titre qui le contient casserait le regroupement.
  return normaliserTitre(base.replace(/\.pdf$/i, "")).slice(0, 200).trim();
}

/**
 * Trim, puis tout tiret cadratin « — » collé à un espace ou en bout de titre devient « - ».
 * « — » entouré d'espaces sépare le titre du morceau dans la mémoire : un titre qui le contient
 * casserait le regroupement.
 */
export function normaliserTitre(titre: string): string {
  return (titre ?? "").trim().replace(/(?<=\s|^)—|—(?=\s|$)/g, "-").trim();
}

/** Titre par défaut d'un texte collé sans titre : `Dossier du 2026-10-06 14:30` (Europe/Paris). */
export function titreParDefaut(now: Date = new Date()): string {
  const d = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(now);
  return `Dossier du ${d}`;
}
