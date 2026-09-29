import { createHash } from "crypto";

// Paramètres de suivi : ils changent d'un partage à l'autre sans changer la page.
// Les garder ferait passer le même article pour deux articles différents.
const PARAMS_DE_SUIVI = /^(utm_|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|spm|xtor|at_medium|at_campaign)/i;

/** URL canonique : la clé d'identité d'un article. Pur. */
export function canonicalizeUrl(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = u.protocol.toLowerCase();
    for (const k of [...u.searchParams.keys()]) {
      if (PARAMS_DE_SUIVI.test(k)) u.searchParams.delete(k);
    }
    u.searchParams.sort();
    let out = u.toString();
    out = out.replace(/\?$/, "");
    // Slash final retiré, sauf sur la racine du domaine.
    if (out.endsWith("/") && new URL(out).pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

/** Hash de l'URL canonique — la valeur stockée dans reading_cards.urlHash. */
export function hashUrl(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** Titre normalisé, pour repérer le même article republié sous une autre URL. */
export function normalizeTitle(title: string): string {
  return (title || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
