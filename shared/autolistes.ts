// shared/autolistes.ts — Autolistes (lot 6, inspiré de Metricool) : une file de posts publiée
// seule à des créneaux récurrents. Règles pures, sans base : lecture des formulaires, prochains
// créneaux (heure locale du fuseau, changements d'heure compris), attribution des posts aux
// créneaux (ordre de la file, boucle ou consommation), clé anti-doublon, ligne de contenu posée.
import { postDepuisModele, type ContenuModele } from "./bibliotheque";
import { MARGE_MINUTES, plateformeDe, problemesProgrammation, type CompteSocial, type GenreMedia, type ProblemeProgrammation } from "./programmation";

export const POSTS_MAX = 200;
export const HORIZON_JOURS = 7;
export const NOM_AUTOLISTE_MAX = 120;
export const CRENEAUX_MAX = 42;
export const COMPTES_MAX = 10;
export const FUSEAU_DEFAUT = "Europe/Paris";

/** `jours` : 0 = dimanche … 6 = samedi (convention de Date.getDay). `heure` : "HH:MM". */
export type Creneau = { heure: string; jours: number[] };

export type AutolisteSaisie = {
  nom: string;
  projectId: number | null;
  actif: boolean;
  enBoucle: boolean;
  creneaux: Creneau[];
  comptes: number[];
};

const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const idPositif = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
};

/** Un créneau lisible (jours triés, dédoublonnés), sinon null. */
export function lireCreneau(v: unknown): Creneau | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.heure !== "string" || !HEURE.test(c.heure)) return null;
  if (!Array.isArray(c.jours) || c.jours.length === 0) return null;
  if (!c.jours.every((j) => Number.isInteger(j) && (j as number) >= 0 && (j as number) <= 6)) return null;
  return { heure: c.heure, jours: Array.from(new Set(c.jours as number[])).sort((a, b) => a - b) };
}

/**
 * Le corps d'une autoliste, validé. `partiel` (modification) : seuls les champs présents sont
 * lus, au moins un. null : illisible (nom vide ou trop long, créneau illisible, compte illisible…).
 */
export function lireAutoliste(body: unknown, partiel = false): Partial<AutolisteSaisie> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const s: Partial<AutolisteSaisie> = {};
  if (b.nom !== undefined || !partiel) {
    if (typeof b.nom !== "string") return null;
    const nom = b.nom.trim();
    if (!nom || nom.length > NOM_AUTOLISTE_MAX) return null;
    s.nom = nom;
  }
  if (b.projectId !== undefined) {
    if (b.projectId === null || b.projectId === "") s.projectId = null;
    else {
      const p = idPositif(b.projectId);
      if (p == null) return null;
      s.projectId = p;
    }
  } else if (!partiel) s.projectId = null;
  for (const k of ["actif", "enBoucle"] as const) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== "boolean") return null;
      s[k] = b[k] as boolean;
    } else if (!partiel) s[k] = k === "actif";
  }
  if (b.creneaux !== undefined || !partiel) {
    const brut = b.creneaux ?? [];
    if (!Array.isArray(brut) || brut.length > CRENEAUX_MAX) return null;
    const creneaux = brut.map(lireCreneau);
    if (creneaux.some((c) => c == null)) return null;
    s.creneaux = creneaux as Creneau[];
  }
  if (b.comptes !== undefined || !partiel) {
    const brut = b.comptes ?? [];
    if (!Array.isArray(brut)) return null;
    const ids = brut.map(idPositif);
    if (ids.some((i) => i == null)) return null;
    const uniques = Array.from(new Set(ids as number[]));
    if (uniques.length > COMPTES_MAX) return null;
    s.comptes = uniques;
  }
  if (partiel && Object.keys(s).length === 0) return null;
  return s;
}

/** Le nouvel ordre de la file : une permutation exacte des ids existants, sinon null. */
export function lireOrdre(body: unknown, existants: number[]): number[] | null {
  const ids = (body as any)?.ids;
  if (!Array.isArray(ids) || ids.length !== existants.length) return null;
  if (!ids.every((i) => Number.isInteger(i))) return null;
  const a = new Set(ids as number[]);
  if (a.size !== ids.length || !existants.every((i) => a.has(i))) return null;
  return ids as number[];
}

// ── Heure locale d'un fuseau ─────────────────────────────────────────────────────────────
const formats = new Map<string, Intl.DateTimeFormat>();
function formatDe(fuseau: string): Intl.DateTimeFormat {
  let f = formats.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formats.set(fuseau, f);
  }
  return f;
}

/** Un fuseau connu d'Intl ; sinon celui de Paris. */
export function fuseauValide(fuseau: string | null | undefined): string {
  if (!fuseau) return FUSEAU_DEFAUT;
  try { formatDe(fuseau); return fuseau; } catch { return FUSEAU_DEFAUT; }
}

function parties(d: Date, fuseau: string) {
  const p = Object.fromEntries(formatDe(fuseau).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, j: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/**
 * L'instant qui s'affiche y-m-j h:min dans le fuseau. Une heure qui n'existe pas (passage à
 * l'heure d'été, 02:30 à Paris) tombe juste après le saut ; une heure qui existe deux fois
 * (passage à l'heure d'hiver) prend l'une des deux, toujours la même.
 */
export function instantLocal(y: number, m: number, j: number, h: number, min: number, fuseau = FUSEAU_DEFAUT): Date {
  const voulu = Date.UTC(y, m - 1, j, h, min);
  let t = voulu;
  for (let i = 0; i < 2; i++) {
    const p = parties(new Date(t), fuseau);
    t += voulu - Date.UTC(p.y, p.m - 1, p.j, p.h, p.min, p.s);
  }
  return new Date(t);
}

/**
 * Les instants des créneaux strictement après `depuis` et au plus tard `jusqua`, triés et sans
 * doublon (deux créneaux à la même heure le même jour n'en font qu'un).
 */
export function prochainsCreneaux(creneaux: Creneau[], depuis: Date, jusqua: Date, fuseau = FUSEAU_DEFAUT): Date[] {
  const tz = fuseauValide(fuseau);
  const debut = parties(depuis, tz);
  const instants = new Set<number>();
  const nbJours = Math.ceil((jusqua.getTime() - depuis.getTime()) / 86_400_000) + 2;
  for (let k = -1; k <= nbJours; k++) {
    const jour = new Date(Date.UTC(debut.y, debut.m - 1, debut.j + k));
    const semaine = jour.getUTCDay();
    for (const c of creneaux) {
      if (!c.jours.includes(semaine)) continue;
      const [h, min] = c.heure.split(":").map(Number);
      const t = instantLocal(jour.getUTCFullYear(), jour.getUTCMonth() + 1, jour.getUTCDate(), h, min, tz).getTime();
      if (t > depuis.getTime() && t <= jusqua.getTime()) instants.add(t);
    }
  }
  return Array.from(instants).sort((a, b) => a - b).map((t) => new Date(t));
}

/** La fenêtre que le planificateur remplit : au-delà de la marge de programmation, 7 jours. */
export function fenetreDePose(maintenant: Date): { depuis: Date; jusqua: Date } {
  return {
    depuis: new Date(maintenant.getTime() + (MARGE_MINUTES + 1) * 60_000),
    jusqua: new Date(maintenant.getTime() + HORIZON_JOURS * 86_400_000),
  };
}

/** Clé anti-doublon d'un créneau posé : une liste, un instant, un compte. */
export function cleCreneau(autolisteId: number, creneau: Date | string, compteId: number): string {
  return `${autolisteId}|${new Date(creneau).toISOString()}|${compteId}`;
}

// ── File et attribution ──────────────────────────────────────────────────────────────────
export type PostDeFile = { id: number; ordre: number; actif: boolean };

/**
 * La file des posts candidats, dans l'ordre. Sans boucle, un post déjà posé sur un créneau à
 * venir (réservé) n'est pas repris : il attend sa publication, après quoi il est consommé.
 * En boucle, tout post actif reste candidat.
 */
export function fileDAttente(posts: PostDeFile[], enBoucle: boolean, reserves: Set<number> = new Set()): number[] {
  return [...posts]
    .sort((a, b) => a.ordre - b.ordre || a.id - b.id)
    .filter((p) => p.actif && (enBoucle || !reserves.has(p.id)))
    .map((p) => p.id);
}

/** Le post suivant de la file, et la file après lui (en boucle : il repart en fin). */
export function avancer(file: number[], enBoucle: boolean): { postId: number | null; file: number[] } {
  if (file.length === 0) return { postId: null, file };
  const [tete, ...reste] = file;
  return { postId: tete, file: enBoucle ? [...reste, tete] : reste };
}

/**
 * Les posts des créneaux, dans l'ordre de la file : un post par créneau ; la file vide, les
 * créneaux restants restent vides. Rend aussi la file après coup (l'ordre à garder en boucle).
 */
export function attribuer(
  file: number[], creneaux: Date[], enBoucle: boolean,
): { attributions: Array<{ creneau: Date; postId: number }>; file: number[] } {
  const attributions: Array<{ creneau: Date; postId: number }> = [];
  let f = file;
  for (const creneau of creneaux) {
    const a = avancer(f, enBoucle);
    if (a.postId == null) break;
    attributions.push({ creneau, postId: a.postId });
    f = a.file;
  }
  return { attributions, file: f };
}

/**
 * Le nouvel ordre de tous les posts après un passage en boucle : la file tournée d'abord,
 * puis les autres (inactifs) dans leur ordre. Rend { id, ordre } pour ceux qui changent.
 */
export function ordreApresBoucle(posts: PostDeFile[], file: number[]): Array<{ id: number; ordre: number }> {
  const dansFile = new Set(file);
  const autres = [...posts].sort((a, b) => a.ordre - b.ordre || a.id - b.id).filter((p) => !dansFile.has(p.id)).map((p) => p.id);
  const avant = new Map(posts.map((p) => [p.id, p.ordre]));
  return [...file, ...autres].map((id, i) => ({ id, ordre: i })).filter((x) => avant.get(x.id) !== x.ordre);
}

/**
 * Bilan des publications d'une liste, par post : nombre de passages publiés (un créneau compte
 * une fois, même sur plusieurs comptes), dernier passage, et consommé (sans boucle, publié).
 */
export function bilanPublications(
  publies: Array<{ autolistePostId: number | null; autolisteCreneau: Date | string | null; publishedAt: Date | string | null }>,
  enBoucle: boolean,
): Map<number, { publieFois: number; dernierPassageAt: Date | null; consomme: boolean }> {
  const parPost = new Map<number, { creneaux: Set<string>; dernier: number | null }>();
  for (const p of publies) {
    if (p.autolistePostId == null) continue;
    const e = parPost.get(p.autolistePostId) ?? { creneaux: new Set<string>(), dernier: null };
    e.creneaux.add(p.autolisteCreneau ? new Date(p.autolisteCreneau).toISOString() : `publie-${p.publishedAt}`);
    const t = p.publishedAt ? new Date(p.publishedAt).getTime() : null;
    if (t != null && (e.dernier == null || t > e.dernier)) e.dernier = t;
    parPost.set(p.autolistePostId, e);
  }
  const sortie = new Map<number, { publieFois: number; dernierPassageAt: Date | null; consomme: boolean }>();
  parPost.forEach((e, id) => {
    sortie.set(id, { publieFois: e.creneaux.size, dernierPassageAt: e.dernier == null ? null : new Date(e.dernier), consomme: !enBoucle && e.creneaux.size > 0 });
  });
  return sortie;
}

// ── Le post posé sur un créneau ──────────────────────────────────────────────────────────
/** Le texte du post pour un réseau : le sien, sinon celui du réseau principal, sinon le premier. */
export function texteDuReseau(contenu: ContenuModele, platform: string): string | null {
  const textes = contenu?.textes ?? {};
  const p = plateformeDe(platform);
  if (typeof textes[p] === "string") return textes[p];
  const principal = plateformeDe(contenu?.platform);
  if (typeof textes[principal] === "string") return textes[principal];
  const premier = Object.values(textes).find((t) => typeof t === "string");
  return premier ?? null;
}

/**
 * La ligne de `content` posée pour un créneau et un compte : le modèle de post, programmé
 * (autoPost) sur ce compte, à cet instant, rattaché à la liste. null : aucun texte.
 */
export function lignePourCreneau(
  contenu: ContenuModele,
  a: {
    userId: string; projectId: number | null; compte: { id: number; platform: string }; creneau: Date; autolisteId: number; autolistePostId: number;
    /** Validation client active pour la marque : le post naît « à valider » (demande à cet instant). */
    aValiderDepuis?: Date | null;
  },
): Record<string, any> | null {
  const platform = plateformeDe(a.compte.platform);
  const texte = texteDuReseau(contenu, platform);
  if (texte == null) return null;
  const row = postDepuisModele({ ...contenu, textes: { ...(contenu?.textes ?? {}), [platform]: texte } }, a.userId, {
    projectId: a.projectId, scheduledFor: a.creneau, platform,
  });
  if (!row) return null;
  // « À finir sur le téléphone » (lot 10) : jamais publié seul ; la tâche « Publier — … » porte
  // la légende et les médias (posée par le passage, comme la validation de l'atelier).
  const telephone = row.finirSurTelephone === true;
  return {
    ...row,
    autoPost: !telephone,
    finirSurTelephone: telephone,
    ...(a.aValiderDepuis ? { validationStatut: "a_valider", validationDemandeeAt: a.aValiderDepuis } : {}),
    postStatus: "pending",
    contentStatus: "ready",
    socialAccountId: a.compte.id,
    crossPostGroupId: `autoliste-${a.autolisteId}-${a.creneau.toISOString()}`,
    autolisteId: a.autolisteId,
    autolistePostId: a.autolistePostId,
    autolisteCreneau: a.creneau,
  };
}

export type ProblemeAutoliste = ProblemeProgrammation | "compte_hors_projet" | "texte_absent";

/** Ce qui empêche de poser cette ligne (mêmes règles que « Programmer »). */
export function problemesDeLaLigne(args: {
  ligne: Record<string, any> | null;
  medias: GenreMedia[];
  compte: CompteSocial | null;
  horsProjet?: boolean;
  maintenant: Date;
}): ProblemeAutoliste[] {
  if (!args.ligne) return ["texte_absent"];
  if (args.horsProjet) return ["compte_hors_projet"];
  return problemesProgrammation({ post: args.ligne as any, medias: args.medias, compte: args.compte, maintenant: args.maintenant });
}

// ── Aperçu « prochains passages » ────────────────────────────────────────────────────────
export type Materialisation = {
  id: number;
  autolistePostId: number | null;
  autolisteCreneau: Date | string | null;
  socialAccountId: number | null;
  postStatus?: string | null;
  publishedAt?: Date | string | null;
  supprimeLe?: Date | string | null;
};

export type Passage = { instant: Date; postId: number | null; pose: boolean; contentIds: number[] };

/**
 * Les passages des 7 prochains jours : les créneaux déjà posés (avec leur post), puis les autres
 * tels que la file les remplira. Un créneau posé puis retiré du calendrier reste sans post.
 */
export function apercuPassages(args: {
  creneaux: Creneau[];
  fuseau?: string;
  enBoucle: boolean;
  actif: boolean;
  posts: PostDeFile[];
  materialisations: Materialisation[];
  maintenant: Date;
}): Passage[] {
  if (!args.actif) return [];
  const { depuis, jusqua } = fenetreDePose(args.maintenant);
  const instants = prochainsCreneaux(args.creneaux, depuis, jusqua, args.fuseau);
  const parCreneau = new Map<number, Materialisation[]>();
  for (const m of args.materialisations) {
    if (!m.autolisteCreneau) continue;
    const t = new Date(m.autolisteCreneau).getTime();
    parCreneau.set(t, [...(parCreneau.get(t) ?? []), m]);
  }
  const reserves = new Set(args.materialisations.filter(estReservation).map((m) => m.autolistePostId as number));
  let file = fileDAttente(args.posts, args.enBoucle, reserves);
  return instants.map((instant) => {
    const poses = parCreneau.get(instant.getTime());
    if (poses?.length) {
      const vivants = poses.filter((m) => !m.supprimeLe);
      return { instant, postId: vivants[0]?.autolistePostId ?? null, pose: true, contentIds: vivants.map((m) => m.id) };
    }
    const a = avancer(file, args.enBoucle);
    file = a.file;
    return { instant, postId: a.postId, pose: false, contentIds: [] };
  });
}

/** Un post posé, vivant, ni publié ni en échec : il réserve son post (liste sans boucle). */
export function estReservation(m: Materialisation): boolean {
  return m.autolistePostId != null && !m.supprimeLe && !m.publishedAt && m.postStatus !== "posted" && m.postStatus !== "failed";
}
