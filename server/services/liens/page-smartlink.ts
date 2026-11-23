// La page publique d'une SmartLink (/b/<slug>) : HTML minimal rendu par le serveur, mobile
// d'abord, sans JavaScript. Tout texte de l'utilisatrice est échappé ; une image n'est affichée
// que si son URL est https ; les couleurs passent par themeSur (#rrggbb seulement). PUR.
import { estUrlSure, themeSur, type ThemeSmartlink } from "@shared/liens";

export function echapperHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PageSmartlink {
  titre: string;
  bio: string;
  avatarUrl: string | null;
  theme: Partial<ThemeSmartlink> | null | undefined;
  /** URL absolue de la page (balises OpenGraph). */
  urlPage: string;
  /** Boutons actifs, dans l'ordre ; href = le lien court (/l/<code>). */
  boutons: Array<{ libelle: string; href: string }>;
  /** Dernières publications ; href null = tuile non cliquable. */
  tuiles: Array<{ imageUrl: string; href: string | null; video?: boolean }>;
}

/** Un href sûr : chemin /l/<code> ou URL http(s). Sinon null. */
function hrefSur(h: string | null | undefined): string | null {
  if (!h) return null;
  if (/^\/l\/[0-9A-Za-z]{7}$/.test(h)) return h;
  return estUrlSure(h) ? h : null;
}

export const CSP_PAGE =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function rendrePageSmartlink(p: PageSmartlink): string {
  const theme = themeSur(p.theme);
  const titre = p.titre.trim() || "Liens";
  const avatar = p.avatarUrl && estUrlSure(p.avatarUrl, true) ? p.avatarUrl : null;
  const boutons = p.boutons
    .map((b) => ({ libelle: b.libelle, href: hrefSur(b.href) }))
    .filter((b): b is { libelle: string; href: string } => !!b.href);
  const tuiles = p.tuiles.filter((t) => estUrlSure(t.imageUrl, true));

  const htmlBoutons = boutons
    .map((b) => `<a class="bouton" href="${echapperHtml(b.href)}" rel="noopener">${echapperHtml(b.libelle)}</a>`)
    .join("\n");
  const htmlTuiles = tuiles.length === 0 ? "" : `<section class="grille" aria-label="Dernières publications">\n${tuiles.map((t) => {
    const img = `<img src="${echapperHtml(t.imageUrl)}" alt="" loading="lazy">`;
    const href = hrefSur(t.href);
    return href ? `<a class="tuile" href="${echapperHtml(href)}" rel="noopener">${img}</a>` : `<div class="tuile">${img}</div>`;
  }).join("\n")}\n</section>`;

  const description = p.bio.trim().slice(0, 200);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapperHtml(titre)}</title>
<meta name="description" content="${echapperHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${echapperHtml(titre)}">
<meta property="og:description" content="${echapperHtml(description)}">
<meta property="og:url" content="${echapperHtml(p.urlPage)}">
${avatar ? `<meta property="og:image" content="${echapperHtml(avatar)}">\n` : ""}<meta name="twitter:card" content="summary">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:${theme.couleurFond};color:${theme.couleurTexte};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;line-height:1.4}
main{max-width:480px;margin:0 auto;padding:40px 16px 32px;display:flex;flex-direction:column;align-items:center;gap:16px}
.avatar{width:88px;height:88px;border-radius:50%;object-fit:cover}
h1{font-size:20px;margin:0;text-align:center}
.bio{margin:0;text-align:center;white-space:pre-line;opacity:.85;font-size:15px}
.boutons{width:100%;display:flex;flex-direction:column;gap:12px;margin-top:8px}
.bouton{display:block;width:100%;padding:14px 16px;border:2px solid ${theme.couleurTexte};border-radius:12px;color:${theme.couleurTexte};text-decoration:none;text-align:center;font-weight:600;font-size:15px;word-break:break-word}
.bouton:hover,.bouton:focus{background:${theme.couleurTexte};color:${theme.couleurFond}}
.grille{width:100%;display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px}
.tuile{display:block;aspect-ratio:1/1;overflow:hidden;background:rgba(0,0,0,.06)}
.tuile img{width:100%;height:100%;object-fit:cover;display:block}
footer{margin-top:24px;font-size:12px;opacity:.55}
</style>
</head>
<body>
<main>
${avatar ? `<img class="avatar" src="${echapperHtml(avatar)}" alt="">\n` : ""}<h1>${echapperHtml(titre)}</h1>
${p.bio.trim() ? `<p class="bio">${echapperHtml(p.bio.trim())}</p>\n` : ""}<nav class="boutons">
${htmlBoutons}
</nav>
${htmlTuiles}
<footer>Naya</footer>
</main>
</body>
</html>
`;
}

export function pageIntrouvable(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page introuvable</title><meta name="robots" content="noindex"></head><body style="font-family:sans-serif;text-align:center;padding:48px 16px;color:#2F3326;background:#F6F1EA"><p>Cette page n'existe pas ou n'est plus en ligne.</p></body></html>`;
}
