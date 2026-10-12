/** Outils de texte de la veille. PUR. */
import { createHash } from "crypto";
import { normaliserTexte } from "../sequence-distinct";

export const normaliser = (s: string | null | undefined) => normaliserTexte(s || "");

/** Empreinte courte et stable d'un texte (casse et espaces ignorés). */
export function empreinte(s: string): string {
  const t = (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha1").update(t).digest("hex").slice(0, 16);
}

/** Domaine (sans www.) d'une URL ou d'un domaine nu ; null si ce n'en est pas un. */
export function domaineDe(url: string | null | undefined): string | null {
  const brut = (url || "").trim();
  if (!brut || /\s/.test(brut)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

/** Vrai si `d` est le domaine `cible` ou l'un de ses sous-domaines. */
export function memeDomaine(d: string | null, cible: string | null): boolean {
  if (!d || !cible) return false;
  return d === cible || d.endsWith(`.${cible}`);
}

/**
 * Retire d'un verbatim ce qui identifie une personne (pseudo Reddit, mention, adresse mail,
 * lien de profil) : la veille garde ce qui est dit, jamais qui l'a dit.
 */
export function anonymiser(t: string): string {
  return (t || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "…")
    .replace(/\/?\bu\/[\w-]+/gi, "…")
    .replace(/\/user\/[\w-]+/gi, "…")
    .replace(/(^|\s)@[\w.]+/g, "$1…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Vrai si `mot` (un ou plusieurs mots) apparaît en mots entiers dans `texte`, sans accents ni casse. */
export function contientMot(texte: string, mot: string): boolean {
  return positionMot(texte, mot) >= 0;
}

/** Position du premier mot entier, dans le texte normalisé ; -1 si absent. */
export function positionMot(texte: string, mot: string): number {
  const m = normaliser(mot);
  if (!m) return -1;
  const t = ` ${normaliser(texte)} `;
  const i = t.indexOf(` ${m} `);
  return i;
}
