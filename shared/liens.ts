// shared/liens.ts — Liens courts avec UTM et SmartLinks (lot 5, inspiré de Metricool « link in
// bio ») : règles pures partagées par le serveur et le client, sans base ni horloge.
//
// Un lien court www.hellonaya.app/l/<code> redirige vers son URL cible, paramètres UTM ajoutés
// (jamais ceux déjà présents écrasés). Une SmartLink est la page publique « lien en bio » d'une
// marque, www.hellonaya.app/b/<slug> : chaque bouton y passe par un lien court, donc compté.

export const CODE_LONGUEUR = 7;
export const CODE_RE = /^[0-9A-Za-z]{7}$/;
export const ALPHABET_CODE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Liens courts créables par compte en 24 h glissantes (boutons de SmartLink compris). */
export const LIENS_PAR_JOUR = 200;
export const URL_MAX = 2048;
export const UTM_MAX = 100;

export const SLUG_RE = /^[a-z0-9-]{3,40}$/;
/** Des chemins de Naya, ou des noms qui prêteraient à confusion. */
export const SLUGS_RESERVES: ReadonlySet<string> = new Set([
  "api", "admin", "app", "b", "l", "www", "naya", "hellonaya", "login", "logout", "signup", "auth",
  "settings", "reglages", "rapport", "rapports", "public", "static", "assets", "objects", "help", "aide",
  "support", "contact", "about", "legal", "cgu", "privacy", "terms", "billing", "stripe", "projects",
  "null", "undefined", "test", "smartlink", "smartlinks", "liens", "lien",
]);

export const LIBELLE_MAX = 80;
export const TITRE_SMARTLINK_MAX = 80;
export const BIO_MAX = 300;
export const BOUTONS_MAX = 30;
export const TUILES_MAX = 9;

export type Utm = Partial<Record<"source" | "medium" | "campaign" | "content" | "term", string>>;
export const CLES_UTM = ["source", "medium", "campaign", "content", "term"] as const;

// ── URL ──────────────────────────────────────────────────────────────────────────────

/** Une URL http(s) absolue, sans identifiants, de longueur raisonnable. Jamais javascript:, data:… */
export function estUrlSure(v: unknown, httpsSeulement = false): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > URL_MAX || /[\s<>"]/.test(s)) return false;
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  if (httpsSeulement ? u.protocol !== "https:" : u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (!u.hostname || u.username || u.password) return false;
  return true;
}

/** Les UTM lisibles d'un corps : chaînes nettoyées (≤ 100), vides ignorées. null : illisible. */
export function lireUtm(v: unknown): Utm | null {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const sortie: Utm = {};
  for (const k of CLES_UTM) {
    const x = (v as Record<string, unknown>)[k];
    if (x == null) continue;
    if (typeof x !== "string") return null;
    const s = x.trim();
    if (s.length > UTM_MAX) return null;
    if (s) sortie[k] = s;
  }
  return sortie;
}

/**
 * L'URL finale d'un lien court : la cible, avec chaque paramètre utm_* ajouté seulement s'il
 * n'y figure pas déjà (la cible garde la main). L'ancre (#…) est conservée.
 */
export function fusionnerUtm(url: string, utm: Utm | null | undefined): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  let change = false;
  for (const k of CLES_UTM) {
    const val = utm?.[k]?.trim();
    if (!val) continue;
    const nom = `utm_${k}`;
    if (u.searchParams.has(nom)) continue;
    u.searchParams.append(nom, val);
    change = true;
  }
  return change ? u.toString() : url;
}

// ── Code et robots ───────────────────────────────────────────────────────────────────

/**
 * Un code de 7 caractères base62 tiré d'octets aléatoires (fournis par l'appelant : crypto côté
 * serveur). Tirage par rejet (octet < 248 = 4 × 62) pour une distribution uniforme.
 */
export function codeDepuisOctets(octets: ArrayLike<number>): string | null {
  let code = "";
  for (let i = 0; i < octets.length && code.length < CODE_LONGUEUR; i++) {
    const o = octets[i];
    if (o < 248) code += ALPHABET_CODE[o % 62];
  }
  return code.length === CODE_LONGUEUR ? code : null;
}

const ROBOTS = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|preview|whatsapp|telegram|discord|skype|slack|vkshare|pinterest|quora link|outbrain|w3c_validator|headless|phantomjs|lighthouse|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpclient|axios\/|node-fetch|undici|monitor|uptime|pingdom|scanner|validator|feedfetcher|google-inspectiontool|apis-google|mediapartners/i;

/** Un robot évident (aperçus de lien, scripts, surveillance) — ou aucun user-agent. */
export function estRobot(ua: unknown): boolean {
  if (typeof ua !== "string" || !ua.trim()) return true;
  return ROBOTS.test(ua);
}

/**
 * Un passage sur /l/<code> compte-t-il comme un clic ? Ni HEAD, ni préchargement (en-têtes
 * Purpose / Sec-Purpose / X-Moz : prefetch), ni robot. La redirection a lieu dans tous les cas.
 */
export function doitCompter(methode: string, entetes: Record<string, unknown>): boolean {
  if (String(methode).toUpperCase() !== "GET") return false;
  const pref = [entetes["purpose"], entetes["sec-purpose"], entetes["x-purpose"], entetes["x-moz"]]
    .map((x) => String(x ?? "").toLowerCase());
  if (pref.some((x) => x.includes("prefetch") || x.includes("preview"))) return false;
  return !estRobot(entetes["user-agent"]);
}

// ── Slug ─────────────────────────────────────────────────────────────────────────────

export type ValiditeSlug = "ok" | "format" | "reserve";

export function validerSlug(v: unknown): ValiditeSlug {
  if (typeof v !== "string" || !SLUG_RE.test(v)) return "format";
  if (SLUGS_RESERVES.has(v)) return "reserve";
  return "ok";
}

/** « Café Mouture ! » → « cafe-mouture » (≤ 40). Peut rendre moins de 3 caractères. */
export function slugifier(nom: string): string {
  return String(nom ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/g, "");
}

// ── Texte (composeur, éditeur) ───────────────────────────────────────────────────────

/** Les URL http(s) d'un texte, dans l'ordre, sans doublon ; la ponctuation finale est retirée. */
export function detecterUrls(texte: string): string[] {
  const vues = new Set<string>();
  for (const m of String(texte ?? "").matchAll(/https?:\/\/[^\s<>"'«»]+/gi)) {
    const url = m[0].replace(/[.,;:!?…)\]}]+$/u, "");
    if (estUrlSure(url) && !vues.has(url)) vues.add(url);
  }
  return Array.from(vues);
}

/** Toutes les occurrences de `ancienne` remplacées par `nouvelle`. */
export function remplacerUrl(texte: string, ancienne: string, nouvelle: string): string {
  return ancienne ? texte.split(ancienne).join(nouvelle) : texte;
}

/** Est-ce déjà un lien court de Naya (base/l/<code>) ? */
export function estLienCourt(url: string, base: string): boolean {
  const b = base.replace(/\/+$/, "");
  return url.startsWith(`${b}/l/`) && CODE_RE.test(url.slice(b.length + 3));
}

/** UTM proposés par défaut : source = réseau, medium = social, campaign = campagne ou marque. */
export function utmParDefaut(reseau?: string | null, campagne?: string | null): Utm {
  const u: Utm = { medium: "social" };
  const r = String(reseau ?? "").trim().toLowerCase();
  if (r) u.source = r;
  const c = slugifier(String(campagne ?? ""));
  if (c) u.campaign = c;
  return u;
}

// ── SmartLink ────────────────────────────────────────────────────────────────────────

export interface BoutonSmartlink {
  /** Identifiant stable du bouton (statistiques), tiré au hasard côté client ou serveur. */
  id: string;
  libelle: string;
  url: string;
  actif: boolean;
  /** Lien court qui compte ses clics (rempli par le serveur). */
  lienId?: number;
  code?: string;
}

export interface LienTuile { url: string; lienId?: number; code?: string }

export interface ThemeSmartlink { couleurFond: string; couleurTexte: string }
export const THEME_DEFAUT: ThemeSmartlink = { couleurFond: "#F6F1EA", couleurTexte: "#2F3326" };
const COULEUR_RE = /^#[0-9a-fA-F]{6}$/;

export function themeSur(v: unknown): ThemeSmartlink {
  const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    couleurFond: typeof t.couleurFond === "string" && COULEUR_RE.test(t.couleurFond) ? t.couleurFond : THEME_DEFAUT.couleurFond,
    couleurTexte: typeof t.couleurTexte === "string" && COULEUR_RE.test(t.couleurTexte) ? t.couleurTexte : THEME_DEFAUT.couleurTexte,
  };
}

export interface SmartlinkSaisie {
  slug: string;
  titre: string;
  bio: string;
  avatarUrl: string | null;
  theme: ThemeSmartlink;
  actif: boolean;
  boutons: Array<{ id: string; libelle: string; url: string; actif: boolean }>;
  tuilesActives: boolean;
  /** contentId → URL https vers laquelle mène la tuile de ce post. */
  liensTuiles: Record<string, string>;
}

export type ErreurSmartlink =
  | "slug_format" | "slug_reserve" | "titre" | "bio" | "avatar" | "boutons" | "bouton_libelle" | "bouton_url" | "tuiles";

const ID_BOUTON_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Le corps d'une SmartLink, validé en entier (création comme modification). Les boutons gardent
 * l'ordre reçu ; leur URL doit être https. Erreur : la première règle enfreinte.
 */
export function lireSmartlink(
  body: unknown,
  nouvelId: () => string,
): { ok: true; valeur: SmartlinkSaisie } | { ok: false; erreur: ErreurSmartlink } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  const vs = validerSlug(slug);
  if (vs === "format") return { ok: false, erreur: "slug_format" };
  if (vs === "reserve") return { ok: false, erreur: "slug_reserve" };
  const titre = typeof b.titre === "string" ? b.titre.trim() : "";
  if (titre.length > TITRE_SMARTLINK_MAX) return { ok: false, erreur: "titre" };
  const bio = typeof b.bio === "string" ? b.bio.trim() : "";
  if (bio.length > BIO_MAX) return { ok: false, erreur: "bio" };
  let avatarUrl: string | null = null;
  if (typeof b.avatarUrl === "string" && b.avatarUrl.trim()) {
    if (!estUrlSure(b.avatarUrl, true)) return { ok: false, erreur: "avatar" };
    avatarUrl = b.avatarUrl.trim();
  } else if (b.avatarUrl != null && b.avatarUrl !== "") return { ok: false, erreur: "avatar" };

  const brut = b.boutons ?? [];
  if (!Array.isArray(brut) || brut.length > BOUTONS_MAX) return { ok: false, erreur: "boutons" };
  const boutons: SmartlinkSaisie["boutons"] = [];
  const ids = new Set<string>();
  for (const x of brut) {
    if (!x || typeof x !== "object") return { ok: false, erreur: "boutons" };
    const o = x as Record<string, unknown>;
    const libelle = typeof o.libelle === "string" ? o.libelle.trim() : "";
    if (!libelle || libelle.length > LIBELLE_MAX) return { ok: false, erreur: "bouton_libelle" };
    if (!estUrlSure(o.url, true)) return { ok: false, erreur: "bouton_url" };
    let id = typeof o.id === "string" && ID_BOUTON_RE.test(o.id) ? o.id : nouvelId();
    while (ids.has(id)) id = nouvelId();
    ids.add(id);
    boutons.push({ id, libelle, url: (o.url as string).trim(), actif: o.actif !== false });
  }

  const liensTuiles: Record<string, string> = {};
  const lt = b.liensTuiles ?? {};
  if (typeof lt !== "object" || Array.isArray(lt)) return { ok: false, erreur: "tuiles" };
  for (const [k, v] of Object.entries(lt as Record<string, unknown>)) {
    if (!/^[1-9]\d{0,9}$/.test(k)) return { ok: false, erreur: "tuiles" };
    if (v == null || v === "") continue;
    if (!estUrlSure(v, true)) return { ok: false, erreur: "tuiles" };
    liensTuiles[k] = (v as string).trim();
  }
  if (Object.keys(liensTuiles).length > 60) return { ok: false, erreur: "tuiles" };

  return {
    ok: true,
    valeur: {
      slug, titre, bio, avatarUrl, theme: themeSur(b.theme), actif: b.actif !== false,
      boutons, tuilesActives: b.tuilesActives === true, liensTuiles,
    },
  };
}

/** Garde le lien court d'avant si l'URL n'a pas changé ; sinon il en faudra un nouveau. */
export function lienRepris<T extends { url: string; lienId?: number; code?: string }>(
  ancien: T | undefined, url: string,
): { lienId: number; code: string } | null {
  return ancien && ancien.url === url && ancien.lienId && ancien.code ? { lienId: ancien.lienId, code: ancien.code } : null;
}
