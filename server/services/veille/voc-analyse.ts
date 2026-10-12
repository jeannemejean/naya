/** Voix du client : lecture des constats extraits par l'IA. PUR. */
import { parseJsonObject } from "../prospection/textes";
import { anonymiser, normaliser } from "./texte";

export const TYPES_VOC = ["objection", "vocabulaire", "attente", "sujet"] as const;
export interface ConstatVoc { type: (typeof TYPES_VOC)[number]; texte: string; verbatim: string; url: string }

/**
 * Garde les constats bien formés dont l'URL est une page réellement lue (pas d'invention),
 * et anonymise les verbatims.
 */
export function lireConstatsVoc(raw: string, urlsLues: Set<string>): ConstatVoc[] {
  const o = parseJsonObject(raw || "");
  const xs: any[] = Array.isArray(o?.constats) ? o.constats : [];
  const out: ConstatVoc[] = [];
  for (const x of xs) {
    if (!TYPES_VOC.includes(x?.type)) continue;
    const texte = typeof x?.texte === "string" ? x.texte.trim().slice(0, 280) : "";
    const url = typeof x?.url === "string" ? x.url.trim() : "";
    if (!texte || !urlsLues.has(url)) continue;
    out.push({ type: x.type, texte, verbatim: anonymiser(typeof x?.verbatim === "string" ? x.verbatim : ""), url });
  }
  return out.slice(0, 12);
}

/** Écarte ce qui est déjà connu (texte normalisé) et les doublons internes. */
export function dedoublonnerConstats<T extends { texte: string }>(connus: string[], nouveaux: T[]): T[] {
  const vus = new Set(connus.map(normaliser));
  const out: T[] = [];
  for (const n of nouveaux) {
    const k = normaliser(n.texte);
    if (!k || vus.has(k)) continue;
    vus.add(k);
    out.push(n);
  }
  return out;
}
