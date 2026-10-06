import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extraction du texte d'un PDF déposé dans le Savoir de Naya.
 * Un PDF scanné (images seules) ne donne pas de texte : on le DIT (`pas_de_texte`)
 * plutôt que de déposer un dossier vide.
 */
export type ResultatExtraction =
  | { statut: "ok"; texte: string }
  | { statut: "pas_un_pdf" | "illisible" | "pas_de_texte" };

export const SEUIL_TEXTE = 200;

export async function extraireTextePdf(buffer: Buffer): Promise<ResultatExtraction> {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { statut: "pas_un_pdf" };
  }
  let texte: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const r = await extractText(pdf, { mergePages: true });
    texte = Array.isArray(r.text) ? r.text.join("\n") : r.text;
  } catch {
    return { statut: "illisible" };
  }
  if (texte.replace(/\s/g, "").length < SEUIL_TEXTE) return { statut: "pas_de_texte" };
  return { statut: "ok", texte };
}

/** Titre d'un dossier = nom du fichier sans `.pdf`, sans chemin, trimé, ≤ 200 caractères. */
export function titreDepuisNomFichier(nom: string): string {
  const base = (nom ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/\.pdf$/i, "").trim().slice(0, 200).trim();
}
