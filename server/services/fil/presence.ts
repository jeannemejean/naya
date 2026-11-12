// Fil conducteur, présence sur les réseaux (spec §5) : la présence ne disparaît jamais. Le seuil
// N (en jours) est lu dans la bande passante de contenu de la marque ; si, pour un compte social
// actif, rien n'a été PUBLIÉ depuis N jours et rien n'est prévu dans les N prochains, Naya
// propose 1 à 3 posts. Ils entrent dans l'atelier de contenu (origine `presence`, sans campagne,
// la consigne posée) et l'atelier du jour est placé, rattaché par la règle « contenu ».
//
// Rien n'est jamais publié sans validation : `autoPost: false`, et ce circuit ne touche à aucun
// chemin de publication. La décision du 9 oct. 2026 tient : le générateur générique ne crée
// toujours pas de tâches de contenu en vrac (filtre-taches-generees.ts) ; c'est un circuit dédié.
import { z } from "zod";
import { plusJours } from "@shared/atelier";

export const SEUIL_DEFAUT = 7;
export const SEUIL_MIN = 2;
export const SEUIL_MAX = 14;
export const POSTS_MAX = 3;

const JOUR_MS = 24 * 3600_000;

// ── Le seuil ───────────────────────────────────────────────────────────────────────────

// Les choix de l'onboarding (client/src/pages/onboarding.tsx, bandwidthSelectOptions).
const CHOIX_ONBOARDING: Record<string, number> = {
  minimal: (3 * 7) / 30, // « quelques publications par mois »
  light: 1,              // « une fois par semaine ou moins »
  moderate: 3,           // « quelques fois par semaine »
  active: 7,             // « quotidien ou quasi-quotidien »
};

const NOMBRES: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, quelques: 3,
  one: 1, two: 2, three: 3, four: 4, five: 5, few: 3, "a few": 3,
};
const MOT_NOMBRE = "\\d+(?:[.,]\\d+)?|a few|few|quelques|une?|deux|trois|quatre|cinq|six|sept|one|two|three|four|five";
// « 2 posts par semaine », « 2 à 3 posts / semaine », « 3x/semaine », « 1/mois », « une fois par mois »…
const RYTHME = new RegExp(
  `(?:^|[^\\w])(${MOT_NOMBRE})\\s*(?:(?:a|-|ou|to|or)\\s*(?:${MOT_NOMBRE})\\s*)?` +
  `(?:x|fois|posts?|publications?|contenus?|times?)?\\s*(?:par|\\/|per|a|an|by|each|every|chaque|tous les|toutes les)?\\s*` +
  `(semaines?|sem|weeks?|wk|mois|months?|jours?|days?)\\b`,
);
const FACTEUR: Array<[RegExp, number]> = [[/^(semaine|sem|week|wk)/, 1], [/^(mois|month)/, 7 / 30], [/^(jour|day)/, 7]];

const normaliser = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Posts par semaine lus dans le texte libre, ou null si aucun rythme n'y est lisible. */
export function postsParSemaine(texte: string | null | undefined): number | null {
  const t = normaliser(texte ?? "");
  if (!t) return null;
  if (t in CHOIX_ONBOARDING) return CHOIX_ONBOARDING[t];
  const m = RYTHME.exec(t);
  if (m) {
    const brut = m[1];
    const nombre = NOMBRES[brut] ?? Number(brut.replace(",", "."));
    const facteur = FACTEUR.find(([re]) => re.test(m[2]))?.[1];
    if (nombre > 0 && facteur) return nombre * facteur;
  }
  if (/quotidien|tous les jours|chaque jour|daily|every ?day/.test(t)) return 7;
  if (/hebdo|chaque semaine|toutes les semaines|weekly|every week/.test(t)) return 1;
  if (/mensuel|chaque mois|tous les mois|monthly|every month/.test(t)) return 7 / 30;
  return null;
}

/**
 * Le seuil de présence N, en jours : ceil(7 / posts par semaine), borné à [2, 14] ; 7 sans
 * rythme lisible. `platformPriority` ne change pas N : il sert seulement à choisir la plateforme
 * (voir `ordonnerComptes`).
 */
export function seuilPresenceJours(contentBandwidth: string | null, _platformPriority: string | null): number {
  const parSemaine = postsParSemaine(contentBandwidth);
  if (parSemaine == null || !(parSemaine > 0)) return SEUIL_DEFAUT;
  return Math.min(SEUIL_MAX, Math.max(SEUIL_MIN, Math.ceil(7 / parSemaine)));
}

// ── L'état de la présence ──────────────────────────────────────────────────────────────

export interface PostPresence {
  publishedAt?: Date | string | null; scheduledFor?: Date | string | null; socialAccountId?: number | null;
  platform?: string | null; contentStatus?: string | null; postStatus?: string | null;
}
export interface CompteActif { id: number; platform: string }

/** Les comptes dans l'ordre de `platformPriority` (texte libre) ; ceux qu'il ne cite pas, ensuite. */
export function ordonnerComptes<C extends CompteActif>(comptes: C[], platformPriority: string | null): C[] {
  const p = normaliser(platformPriority ?? "");
  const rang = (c: C) => { const i = p ? p.indexOf(normaliser(c.platform)) : -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return comptes.map((c, i) => ({ c, i })).sort((a, b) => rang(a.c) - rang(b.c) || a.i - b.i).map((x) => x.c);
}

const date = (v: Date | string | null | undefined): Date | null => (v ? new Date(v) : null);
const estPublie = (p: PostPresence) =>
  p.publishedAt != null || p.postStatus === "posted" || (p.contentStatus ?? "").toLowerCase() === "published";
// Le compte d'un post : celui qu'il désigne, sinon (aucun compte désigné) celui de sa plateforme.
const couvre = (p: PostPresence, c: CompteActif) =>
  p.socialAccountId != null ? p.socialAccountId === c.id : normaliser(p.platform ?? "") === normaliser(c.platform);

/**
 * `aProposer` : pour au moins un compte actif (dans l'ordre reçu), aucun post PUBLIÉ depuis `n`
 * jours et aucun post prévu dans les `n` prochains jours. Un post programmé mais jamais publié ne
 * compte pas comme publié ; un post en échec n'est pas prévu. `plateforme` : celle du premier
 * compte à couvrir. `joursDepuisDernier` : jours depuis la dernière publication, tous comptes
 * confondus (null : aucune parmi les posts reçus).
 */
export function etatPresence(
  posts: PostPresence[], comptesActifs: CompteActif[], n: number, maintenant: Date,
): { aProposer: boolean; plateforme: string | null; joursDepuisDernier: number | null } {
  const t = maintenant.getTime();
  const debut = t - n * JOUR_MS;
  const fin = t + n * JOUR_MS;
  let dernier: number | null = null;
  for (const p of posts) {
    if (!estPublie(p)) continue;
    const d = (date(p.publishedAt) ?? date(p.scheduledFor))?.getTime();
    if (d != null && d <= t && (dernier == null || d > dernier)) dernier = d;
  }
  const joursDepuisDernier = dernier == null ? null : Math.floor((t - dernier) / JOUR_MS);

  const present = (c: CompteActif) => posts.some((p) => {
    if (!couvre(p, c)) return false;
    if (estPublie(p)) {
      const d = (date(p.publishedAt) ?? date(p.scheduledFor))?.getTime();
      return d != null && d >= debut && d <= t;
    }
    if (p.postStatus === "failed") return false;
    const s = date(p.scheduledFor)?.getTime();
    return s != null && s >= t && s <= fin;
  });
  const manquant = comptesActifs.find((c) => !present(c));
  return { aProposer: !!manquant, plateforme: manquant?.platform ?? null, joursDepuisDernier };
}

// ── Les posts proposés ─────────────────────────────────────────────────────────────────

export interface AdnPresence { contentBandwidth: string | null; platformPriority: string | null; contentPillars: string[] | null }

export interface DepsPresence {
  adn(userId: string): Promise<AdnPresence | null>;
  /** Le projet de l'unique objectif de visibilité (règle « contenu » du rattachement), ou null. */
  projetVisibilite(userId: string): Promise<number | null>;
  /** Comptes sociaux actifs dans le périmètre du projet (ceux de l'utilisatrice si null). */
  comptesActifs(userId: string, projectId: number | null): Promise<CompteActif[]>;
  /**
   * Posts programmés ou publiés entre ces deux instants (tous circuits confondus), dans le
   * périmètre du projet : ceux d'un projet client ne comptent pas pour la marque, et inversement.
   */
  postsEntre(userId: string, debut: Date, fin: Date, projectId: number | null): Promise<Array<PostPresence & { title?: string | null }>>;
  /** Posts `origine='presence'` non publiés, créés depuis `debut` ou prévus dans [debut, fin]. */
  propositionsEnAttente(userId: string, debut: Date, fin: Date): Promise<number>;
  /** Le calendrier de travail de l'utilisatrice (jours travaillés, indisponibilités). */
  estTravaille(userId: string, debut: string, fin: string): Promise<(jour: string) => boolean>;
  iaBloquee(userId: string): Promise<boolean>;
  ia(userId: string, projectId: number | null, consigne: string, plateformes: string[]): Promise<string>;
  creerPost(valeurs: Record<string, unknown>): Promise<{ id: number } & Record<string, any>>;
  /** Pose l'atelier de ces posts (placement idempotent, rattaché par la règle « contenu »). */
  placer(userId: string, posts: any[]): Promise<{ creees: number }>;
}

const SortiePosts = z.object({
  posts: z.array(z.object({
    titre: z.string().trim().min(1).max(200),
    consigne: z.string().trim().min(1).max(2000),
    plateforme: z.string().trim().min(1),
    pilier: z.string().trim().max(120).optional().nullable(),
  })).min(1).max(POSTS_MAX),
});

// Le premier objet JSON du texte, ou undefined.
function jsonDe(texte: string): unknown {
  const bloc = texte.match(/\{[\s\S]*\}/)?.[0];
  if (!bloc) return undefined;
  try { return JSON.parse(bloc); } catch { return undefined; }
}

// Paris : le jour de l'utilisatrice (le serveur tourne en UTC).
function jourParis(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const formatPour = (plateforme: string) => (normaliser(plateforme) === "linkedin" ? "text" : "feed_image");

function promptPresence(a: {
  plateforme: string; plateformes: string[]; n: number; joursDepuisDernier: number | null; nombre: number;
  adn: AdnPresence | null; recents: string[];
}): string {
  const piliers = (a.adn?.contentPillars ?? []).map((p) => p.trim()).filter(Boolean);
  return [
    a.joursDepuisDernier == null
      ? `Rien n'a été publié récemment sur ${a.plateforme}, et rien n'y est prévu dans les ${a.n} prochains jours.`
      : `Dernière publication il y a ${a.joursDepuisDernier} jours ; rien n'est prévu sur ${a.plateforme} dans les ${a.n} prochains jours.`,
    `Rythme que la marque s'est donné : ${a.adn?.contentBandwidth?.trim() || "non précisé"}.`,
    piliers.length ? `Ses piliers de contenu : ${piliers.join(" ; ")}.` : "Pas de piliers de contenu définis : appuie-toi sur son positionnement.",
    `Plateformes possibles : ${a.plateformes.join(", ")} (priorité : ${a.plateforme}).`,
    a.recents.length ? `Sujets déjà traités récemment (ne pas les répéter) :\n${a.recents.map((t) => `- ${t}`).join("\n")}` : "",
    "",
    `Propose ${a.nombre === 1 ? "1 post" : `${a.nombre} posts (entre 1 et ${POSTS_MAX})`} pour garder la présence de la marque, propres à elle et pas génériques.`,
    "Fonde chaque idée sur ce que tu sais d'elle : son identité et son positionnement, ses piliers, la veille de son marché et la revue du jour, l'actualité de son projet (ce qu'elle t'a dit de là où elle en est).",
    "N'invente aucun chiffre, aucun client, aucun témoignage : s'il en faut un, écris [à compléter].",
    "Pour chaque post : un titre interne court ; une consigne de 2 à 4 phrases qui dit l'angle, l'accroche visée et la matière précise à utiliser (pas le texte du post) ; la plateforme (une de la liste) ; le pilier.",
    'Réponds UNIQUEMENT en JSON : {"posts":[{"titre":"…","consigne":"…","plateforme":"…","pilier":"…"}]}',
  ].filter((l) => l !== "").join("\n");
}

// Un passage à la fois par utilisatrice : deux passages simultanés liraient tous deux « aucune
// proposition en attente » et créeraient deux lots. Le serveur tourne en une seule instance.
const enCours = new Map<string, Promise<unknown>>();

/**
 * Propose 1 à 3 posts à l'atelier quand la présence manque (voir `etatPresence`). Ne fait rien
 * (aucun appel IA) un jour non travaillé, si l'IA est bloquée, si la présence est assurée, ou si
 * un post proposé non publié existe déjà dans la fenêtre de N jours. Jamais de publication.
 */
export async function proposerPostsPresence(
  userId: string, maintenant: Date, deps?: DepsPresence,
): Promise<{ crees: number }> {
  const d = deps ?? (await import("./presence-deps")).depsPresence;
  const precedent = enCours.get(userId) ?? Promise.resolve();
  const courant = precedent.catch(() => {}).then(() => proposerSeul(userId, maintenant, d));
  enCours.set(userId, courant);
  try {
    return await courant;
  } finally {
    if (enCours.get(userId) === courant) enCours.delete(userId);
  }
}

async function proposerSeul(userId: string, maintenant: Date, deps: DepsPresence): Promise<{ crees: number }> {
  const aujourdhui = jourParis(maintenant);
  const estTravaille = await deps.estTravaille(userId, aujourdhui, plusJours(aujourdhui, 30));
  // Un jour non travaillé : l'atelier du jour n'aurait pas de jour ; le prochain matin travaillé s'en charge.
  if (!estTravaille(aujourdhui)) return { crees: 0 };
  if (await deps.iaBloquee(userId)) return { crees: 0 };

  const adn = await deps.adn(userId);
  const n = seuilPresenceJours(adn?.contentBandwidth ?? null, adn?.platformPriority ?? null);
  const debut = new Date(maintenant.getTime() - n * JOUR_MS);
  const fin = new Date(maintenant.getTime() + n * JOUR_MS);
  if ((await deps.propositionsEnAttente(userId, debut, fin)) > 0) return { crees: 0 };

  const projectId = await deps.projetVisibilite(userId);
  const comptes = ordonnerComptes(await deps.comptesActifs(userId, projectId), adn?.platformPriority ?? null);
  if (comptes.length === 0) return { crees: 0 };
  // Assez loin en arrière pour dater la dernière publication et lire les sujets récents.
  const posts = await deps.postsEntre(userId, new Date(maintenant.getTime() - Math.max(n, 30) * JOUR_MS), fin, projectId);
  const etat = etatPresence(posts, comptes, n, maintenant);
  if (!etat.aProposer || !etat.plateforme) return { crees: 0 };

  const plateformes = Array.from(new Set(comptes.map((c) => c.platform)));
  const nombre = Math.min(POSTS_MAX, Math.max(1, Math.round(7 / n)));
  const recents = Array.from(new Set(posts.map((p) => (p.title ?? "").trim()).filter(Boolean))).slice(-15);
  const consigne = promptPresence({ plateforme: etat.plateforme, plateformes, n, joursDepuisDernier: etat.joursDepuisDernier, nombre, adn, recents });

  let propositions: z.infer<typeof SortiePosts>["posts"] | null = null;
  let remarque = "";
  for (let essai = 0; essai < 2 && !propositions; essai++) {
    const v = SortiePosts.safeParse(jsonDe(await deps.ia(userId, projectId, consigne + remarque, plateformes)));
    if (v.success) propositions = v.data.posts;
    else remarque = `\n\nTa réponse précédente n'était pas un JSON valide de 1 à ${POSTS_MAX} posts. Recommence.`;
  }
  if (!propositions) return { crees: 0 };

  // Les prochains jours travaillés après aujourd'hui, un post par jour.
  const jours: string[] = [];
  for (let j = plusJours(aujourdhui, 1), garde = 0; jours.length < propositions.length && garde < 30; j = plusJours(j, 1), garde++) {
    if (estTravaille(j)) jours.push(j);
  }
  const crees: any[] = [];
  for (let i = 0; i < Math.min(propositions.length, jours.length); i++) {
    const p = propositions[i];
    // Une plateforme hors des comptes actifs retombe sur celle à couvrir.
    const compte = comptes.find((c) => normaliser(c.platform) === normaliser(p.plateforme))
      ?? comptes.find((c) => c.platform === etat.plateforme)!;
    const format = formatPour(compte.platform);
    crees.push(await deps.creerPost({
      userId, projectId, campaignId: null, origine: "presence",
      title: p.titre, body: "", consigne: p.consigne,
      platform: compte.platform, socialAccountId: compte.id,
      postFormat: format, contentType: "post", pillar: p.pilier?.trim() || "présence", goal: "visibility",
      contentStatus: "idea", publishedAt: null,
      // Jamais de publication sans validation : un post proposé n'est pas programmé.
      autoPost: false,
      scheduledFor: new Date(`${jours[i]}T08:00:00.000Z`),
    }));
  }
  if (crees.length === 0) return { crees: 0 };
  await deps.placer(userId, crees);
  return { crees: crees.length };
}
