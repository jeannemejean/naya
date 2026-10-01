import { db } from "../../db";
import { and, eq, gte, lte, or, inArray } from "drizzle-orm";
import { projectLinks, content, projects } from "@shared/schema";
import { callClaude, callClaudeDetailed, CLAUDE_MODELS } from "../claude";

/** Fenêtre de comparaison autour de la date de programmation. */
export const FENETRE_JOURS = 7;
/** Plafond de contenus envoyés au jugement, pour borner le prompt. */
export const MAX_CONTENUS_COMPARES = 12;
// `content.title` est un `text` Postgres SANS longueur maximale : rien n'empêche un
// titre anormalement long (un corps collé par erreur dans le titre, un bug en amont).
// Le best-effort absorberait l'incident (aucun crash), mais "le prompt est borné"
// deviendrait faux en pratique — donc on tronque aussi les titres, pas seulement les
// corps. 200 caractères : un titre de post tient normalement en une phrase (bien en
// dessous de ce seuil), donc aucun titre légitime n'est jamais coupé ; la valeur
// borne seulement le cas pathologique, sans avoir besoin d'être généreuse comme pour
// un corps de texte.
export const LONGUEUR_MAX_TITRE = 200;

export interface Collision {
  contenuId: number;
  marque: string;
  scheduledFor: Date | null;
  pourquoi: string;
}

/**
 * Plafond de posts du LOT envoyés au modèle en un seul appel. Ne borne QUE les
 * nouveaux contenus — les voisins déjà programmés sont bornés séparément par
 * `MAX_CONTENUS_COMPARES`, à l'intérieur de `voisinsProgrammes`.
 */
export const PLAFOND_POSTS_LOT = 12;

// Pourquoi un appel au modèle, et pas une comparaison d'embeddings — alors que le dépôt
// a déjà `embedText` et pgvector pour d'autres usages : ce qu'on cherche ici est une
// collision d'ANGLE, pas une ressemblance de texte. Deux posts peuvent ne partager
// aucun mot et dire exactement la même chose ("on lance la méthode" / "la formation
// ouvre ses portes") ; ou partager tout leur vocabulaire et dire l'inverse ("on ouvre
// les portes" / "on ferme les portes"). Un embedding mesure la proximité du texte, pas
// l'identité de l'angle qu'il sert — c'est la première chose qu'il faudra revérifier
// si quelqu'un veut un jour remplacer cet appel par une comparaison vectorielle.
export const PROMPT_COLLISION = `Deux marques de la même personne partagent une partie de leur audience.

On te donne un contenu qui va être programmé, et des contenus déjà programmés sur la
marque liée dans les jours qui l'entourent. Tu réponds à UNE seule question : l'un de
ces contenus sert-il le MÊME ANGLE que celui qu'on programme ?

Le même angle, ce n'est pas le même sujet : deux posts peuvent parler du même thème en
disant des choses différentes, et ce n'est pas une collision. C'est une collision quand
un abonné qui voit les deux aurait l'impression de lire deux fois la même chose.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"collision": false}
ou
{"collision": true, "contenuId": 1, "pourquoi": "<une phrase, en français>"}

"contenuId" est l'identifiant indiqué après "Identifiant : " dans la liste ci-dessous,
pour le contenu en collision. C'est un NOMBRE ENTIER NU — 1, jamais "1", jamais [1],
jamais "Identifiant : 1" : recopie le chiffre seul, sans aucune ponctuation autour.`;

// Un identifiant non interprétable (aucun chiffre dedans) n'est jamais une cible : on le
// rejette sans essayer de deviner. Pur.
function extraireEntier(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Tolère la ponctuation que le modèle recopie parfois de la présentation qu'on lui a
    // montrée ("[1]", "Identifiant : 1", "#1"...) : on extrait le premier nombre trouvé,
    // plutôt que d'exiger une chaîne qui soit DÉJÀ un nombre pur.
    const m = v.match(/-?\d+/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Lit le verdict du modèle. Pure, tolérante à la ponctuation que le modèle recopie
 * parfois autour de l'identifiant ("[1]", "1", "Identifiant : 1"). Une alerte sans
 * cible INTERPRÉTABLE est jetée ici ; une alerte dont l'identifiant interprété ne
 * correspond à AUCUN contenu réel est jetée plus loin, par `detecterCollision` — les
 * deux filtres sont nécessaires et aucun ne remplace l'autre : celui-ci absorbe le
 * bavardage de ponctuation, l'autre absorbe l'invention pure et simple d'un identifiant.
 */
export function parseVerdict(raw: string): { contenuId: number; pourquoi: string } | null {
  if (!raw) return null;
  const debut = raw.indexOf("{");
  const fin = raw.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  let o: any;
  try { o = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  if (o?.collision !== true) return null;
  const contenuId = extraireEntier(o.contenuId);
  if (contenuId === null) return null;
  return { contenuId, pourquoi: typeof o.pourquoi === "string" ? o.pourquoi : "" };
}

/**
 * Identifiants des marques liées à `projectId` par un lien `audiencesRecoupent`.
 * Rend un tableau vide si aucun lien de ce type n'existe — c'est CE tableau vide qui
 * sert de garde partout ailleurs : l'absence de lien est une interdiction de
 * rapprocher deux marques, y compris pour les comparer.
 *
 * Partagée par `detecterCollision` et `detecterCollisionLot` : extraite ici pour que
 * les deux chemins posent EXACTEMENT la même question à la base (même clause WHERE),
 * preuve faite par les tests existants qui inspectent le SQL rendu.
 */
async function liensAvecRecoupement(userId: string, projectId: number): Promise<number[]> {
  const liens = await db.select().from(projectLinks).where(and(
    eq(projectLinks.userId, userId),
    eq(projectLinks.audiencesRecoupent, true),
    or(eq(projectLinks.fromProjectId, projectId), eq(projectLinks.toProjectId, projectId)),
  ));
  return liens.map((l) => (l.fromProjectId === projectId ? l.toProjectId : l.fromProjectId));
}

/**
 * Contenus déjà programmés sur l'une des marques de `autresIds`, dans la fenêtre
 * [debut, fin], triés par date de programmation et bornés à `MAX_CONTENUS_COMPARES`.
 *
 * Partagée par `detecterCollision` (fenêtre centrée sur une seule date) et
 * `detecterCollisionLot` (fenêtre élargie à l'amplitude du lot) : la requête elle-même
 * ne connaît que ses bornes, pas comment elles ont été calculées.
 */
async function voisinsProgrammes(
  userId: string,
  autresIds: number[],
  debut: Date,
  fin: Date,
): Promise<Array<{ id: number; title: string; body: string | null; projectId: number | null; scheduledFor: Date | null }>> {
  return db
    .select({
      id: content.id, title: content.title, body: content.body,
      projectId: content.projectId, scheduledFor: content.scheduledFor,
    })
    .from(content)
    .where(and(
      eq(content.userId, userId),
      // `content.projectId` est NULLABLE (vérifié dans le schéma) : `inArray` écarte
      // déjà les lignes nulles, mais on ne s'appuie pas sur ce détail de drizzle —
      // `autresIds` ne contient que des identifiants réels, donc un contenu sans
      // marque ne peut pas entrer dans la comparaison.
      inArray(content.projectId, autresIds),
      gte(content.scheduledFor, debut),
      lte(content.scheduledFor, fin),
    ))
    // ORDER BY explicite : sans lui, QUELS contenus sont comparés quand le plafond
    // tombe dépend de l'ordre physique de Postgres, qui peut changer d'un jour à
    // l'autre — l'alerte deviendrait non déterministe.
    .orderBy(content.scheduledFor)
    .limit(MAX_CONTENUS_COMPARES);
}

/**
 * Cherche une collision d'angle entre le contenu qu'on programme et ce qui est déjà
 * programmé sur les marques liées dont l'audience se recoupe.
 *
 * Ne s'exécute QUE s'il existe un lien avec `audiencesRecoupent`. Sans lien, on rend
 * null sans interroger quoi que ce soit : l'absence de lien est une interdiction de
 * rapprocher deux marques, y compris pour les comparer.
 *
 * Best-effort de bout en bout : tout échec rend null et journalise. Cette fonction ne
 * doit JAMAIS faire échouer la programmation d'un contenu.
 */
export async function detecterCollision(input: {
  userId: string;
  projectId: number;
  titre: string;
  corps: string;
  quand: Date;
}): Promise<Collision | null> {
  try {
    const autresIds = await liensAvecRecoupement(input.userId, input.projectId);
    if (autresIds.length === 0) return null;

    const debut = new Date(input.quand.getTime() - FENETRE_JOURS * 24 * 3600 * 1000);
    const finFenetre = new Date(input.quand.getTime() + FENETRE_JOURS * 24 * 3600 * 1000);

    const voisins = await voisinsProgrammes(input.userId, autresIds, debut, finFenetre);

    if (voisins.length === 0) return null;

    // Présentation SANS crochets ni autre ponctuation collée à l'identifiant : la forme
    // "[1] Titre" s'est révélée à l'usage réel reproduite telle quelle par le modèle dans
    // sa réponse ("contenuId": "[1]"), que `parseVerdict` rejetait avant ce correctif.
    // "Identifiant : " sur sa propre ligne laisse le chiffre nu, sans rien à recopier
    // autour de lui.
    const liste = voisins
      .map((v) => `Identifiant : ${v.id}\nTitre : ${v.title.slice(0, LONGUEUR_MAX_TITRE)}\n${String(v.body ?? "").slice(0, 400)}`)
      .join("\n\n");

    const raw = await callClaude({
      model: CLAUDE_MODELS.fast,
      taskKind: "classification",
      system: PROMPT_COLLISION,
      max_tokens: 400,
      userId: input.userId,
      projectId: input.projectId,
      messages: [{
        role: "user",
        content: `CONTENU QU'ON PROGRAMME\n${input.titre.slice(0, LONGUEUR_MAX_TITRE)}\n${input.corps.slice(0, 800)}\n\nDÉJÀ PROGRAMMÉ SUR LA MARQUE LIÉE\n${liste}`,
      }],
    });

    const verdict = parseVerdict(raw);
    if (!verdict) return null;

    const cible = voisins.find((v) => v.id === verdict.contenuId);
    // Le modèle a pu inventer un identifiant : sans cible réelle, pas d'alerte.
    if (!cible) return null;

    const [marque] = await db.select({ name: projects.name }).from(projects)
      .where(eq(projects.id, cible.projectId as number));

    return {
      contenuId: cible.id,
      marque: marque?.name ?? "une marque liée",
      scheduledFor: cible.scheduledFor,
      pourquoi: verdict.pourquoi,
    };
  } catch (err: any) {
    console.error(`[Liens] détection de collision échouée pour le projet ${input.projectId}:`, err?.message);
    return null;
  }
}

export interface CollisionLot {
  nouveauId: number;
  contenuId: number;
  marque: string;
  scheduledFor: Date | null;
  pourquoi: string;
}

// Un collage crée plusieurs contenus datés d'un coup : les deux côtés du prompt portent
// déjà de VRAIS identifiants de base (les posts du lot sont écrits avant que cette
// détection s'exécute — voir la tâche d'orchestration de l'import). Il n'y a donc aucun
// index à faire correspondre ; deux étiquettes distinctes ("Nouveau contenu : " et
// "Déjà programmé : ") évitent toute confusion entre les deux listes.
export const PROMPT_COLLISION_LOT = `Deux marques de la même personne partagent une partie de leur audience.

On te donne une LISTE de nouveaux contenus qui vont être programmés, et une LISTE de
contenus déjà programmés sur la marque liée dans les jours qui les entourent. Pour
CHAQUE nouveau contenu, tu réponds à UNE seule question : l'un des contenus déjà
programmés sert-il le MÊME ANGLE que lui ?

Le même angle, ce n'est pas le même sujet : deux posts peuvent parler du même thème en
disant des choses différentes, et ce n'est pas une collision. C'est une collision quand
un abonné qui voit les deux aurait l'impression de lire deux fois la même chose.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"collisions": [{"nouveauId": 412, "contenuId": 207, "pourquoi": "<une phrase, en français>"}]}
ou, s'il n'y a aucune collision :
{"collisions": []}

"nouveauId" est l'identifiant indiqué après "Nouveau contenu : " pour le nouveau
contenu en collision, et "contenuId" est l'identifiant indiqué après "Déjà
programmé : " pour le contenu déjà programmé qui lui fait collision. CE SONT DES
NOMBRES ENTIERS NUS — 1, jamais "1", jamais [1], jamais "Nouveau contenu : 1", jamais
"Déjà programmé : 1" : recopie le chiffre seul, sans aucune ponctuation autour.`;

/**
 * Lit le verdict du modèle pour un LOT entier. Même double filtre que `parseVerdict`,
 * appliqué à chaque couple : tolérance de ponctuation à la lecture (`extraireEntier`),
 * PUIS vérification que les DEUX identifiants interprétés existent réellement — l'un
 * dans l'ensemble des nouveaux contenus envoyés, l'autre dans l'ensemble des voisins
 * réels. Un couple dont l'un des deux identifiants est inventé par le modèle est
 * écarté EN ENTIER : on ne garde jamais la moitié valide d'un couple. Les deux filtres
 * sont nécessaires et aucun ne remplace l'autre — le premier absorbe le bavardage de
 * ponctuation, le second absorbe l'invention pure et simple d'un identifiant.
 */
export function parseVerdictLot(
  raw: string,
  idsNouveaux: Set<number>,
  idsVoisins: Set<number>,
): Array<{ nouveauId: number; contenuId: number; pourquoi: string }> {
  if (!raw) return [];
  const debut = raw.indexOf("{");
  const fin = raw.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return [];
  let o: any;
  try { o = JSON.parse(raw.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(o?.collisions)) return [];

  const resultat: Array<{ nouveauId: number; contenuId: number; pourquoi: string }> = [];
  for (const item of o.collisions) {
    const nouveauId = extraireEntier(item?.nouveauId);
    const contenuId = extraireEntier(item?.contenuId);
    if (nouveauId === null || contenuId === null) continue;
    if (!idsNouveaux.has(nouveauId) || !idsVoisins.has(contenuId)) continue;
    resultat.push({ nouveauId, contenuId, pourquoi: typeof item?.pourquoi === "string" ? item.pourquoi : "" });
  }
  return resultat;
}

/**
 * Cherche des collisions d'angle entre un LOT de contenus qu'on vient d'écrire (un
 * collage = plusieurs contenus datés d'un coup) et ce qui est déjà programmé sur les
 * marques liées dont l'audience se recoupe. Variante en lot de `detecterCollision`,
 * en UN SEUL appel au modèle plutôt qu'un appel par post.
 *
 * Ne s'exécute QUE s'il existe un lien avec `audiencesRecoupent`. Sans lien, on rend
 * `[]` sans interroger `content` : l'absence de lien est une interdiction de
 * rapprocher deux marques, y compris pour les comparer — pas une optimisation.
 *
 * Best-effort de bout en bout : tout échec (base en panne, modèle en panne, réponse
 * illisible) rend `[]` et journalise. Cette fonction ne doit JAMAIS faire échouer un
 * import — les posts sont déjà écrits et commités en base quand elle s'exécute.
 */
export async function detecterCollisionLot(input: {
  userId: string;
  projectId: number;
  posts: Array<{ id: number; titre: string; corps: string; quand: Date }>;
}): Promise<CollisionLot[]> {
  try {
    if (input.posts.length === 0) return [];

    const autresIds = await liensAvecRecoupement(input.userId, input.projectId);
    if (autresIds.length === 0) return [];

    // La fenêtre couvre l'AMPLITUDE du lot entier, pas la date d'un seul post : chaque
    // borne encadre la plus ancienne et la plus récente des dates du lot, étendues de
    // FENETRE_JOURS de part et d'autre — sinon un lot étalé sur plusieurs semaines
    // laisserait certains de ses posts sans aucun voisin comparé.
    const dates = input.posts.map((p) => p.quand.getTime());
    const debut = new Date(Math.min(...dates) - FENETRE_JOURS * 24 * 3600 * 1000);
    const fin = new Date(Math.max(...dates) + FENETRE_JOURS * 24 * 3600 * 1000);

    const voisins = await voisinsProgrammes(input.userId, autresIds, debut, fin);
    if (voisins.length === 0) return [];

    // Plafonne les NOUVEAUX contenus envoyés au modèle — pas les voisins, déjà bornés
    // par `voisinsProgrammes` (MAX_CONTENUS_COMPARES). `input.posts` est un tableau EN
    // MÉMOIRE dont on connaît la longueur exacte : le nombre écarté journalisé est donc
    // un compte réel, jamais une approximation déduite d'une requête bornée par LIMIT.
    const postsEnvoyes = input.posts.slice(0, PLAFOND_POSTS_LOT);
    if (input.posts.length > PLAFOND_POSTS_LOT) {
      console.info(
        `[Liens] détection de collision en lot pour le projet ${input.projectId} : ` +
        `${input.posts.length - PLAFOND_POSTS_LOT} post(s) écarté(s) au-delà du ` +
        `plafond de ${PLAFOND_POSTS_LOT}.`,
      );
    }

    const idsNouveaux = new Set(postsEnvoyes.map((p) => p.id));
    const idsVoisins = new Set(voisins.map((v) => v.id));

    const listeNouveaux = postsEnvoyes
      .map((p) => `Nouveau contenu : ${p.id}\nTitre : ${p.titre.slice(0, LONGUEUR_MAX_TITRE)}\n${p.corps.slice(0, 400)}`)
      .join("\n\n");
    const listeVoisins = voisins
      .map((v) => `Déjà programmé : ${v.id}\nTitre : ${v.title.slice(0, LONGUEUR_MAX_TITRE)}\n${String(v.body ?? "").slice(0, 400)}`)
      .join("\n\n");

    const { text: raw, stopReason } = await callClaudeDetailed({
      model: CLAUDE_MODELS.fast,
      taskKind: "classification",
      system: PROMPT_COLLISION_LOT,
      // Un lot peut produire plusieurs collisions (une par paire en collision), contre
      // un verdict unique pour `detecterCollision` : le budget est plus large.
      max_tokens: 2000,
      userId: input.userId,
      projectId: input.projectId,
      messages: [{
        role: "user",
        content: `NOUVEAUX CONTENUS\n${listeNouveaux}\n\nDÉJÀ PROGRAMMÉ SUR LA MARQUE LIÉE\n${listeVoisins}`,
      }],
    });

    // DEUX valeurs, pas une : les providers ne nomment pas la troncature de la même
    // façon ("max_tokens" / "length" — voir `server/services/content-import/import.ts`).
    // On ne réutilise pas `assertNotTruncated` ici : elle LÈVE, ce qui est incompatible
    // avec le best-effort de cette fonction. Mais sans ce garde-fou, une réponse coupée
    // produirait un JSON illisible, `parseVerdictLot` rendrait `[]`, et "aucune
    // collision" deviendrait un énoncé FAUX présenté comme un résultat, en silence.
    if (stopReason === "max_tokens" || stopReason === "length") {
      console.info(
        `[Liens] détection de collision en lot pour le projet ${input.projectId} : ` +
        `réponse du modèle tronquée (${stopReason}) — les collisions annoncées après ` +
        `la coupure sont perdues.`,
      );
    }

    const couples = parseVerdictLot(raw, idsNouveaux, idsVoisins);
    if (couples.length === 0) return [];

    // Noms des marques des voisins impliqués — une seule requête pour tout le lot,
    // jamais une requête par couple.
    const projetsVoisins = Array.from(new Set(
      voisins.map((v) => v.projectId).filter((id): id is number => id !== null),
    ));
    const marques = projetsVoisins.length === 0
      ? []
      : await db.select({ id: projects.id, name: projects.name }).from(projects)
          .where(inArray(projects.id, projetsVoisins));
    const nomParId = new Map(marques.map((m) => [m.id, m.name]));
    const voisinParId = new Map(voisins.map((v) => [v.id, v]));

    return couples.map((c) => {
      // `c.contenuId` a déjà été vérifié par `parseVerdictLot` comme appartenant à
      // `idsVoisins` : la cible existe forcément dans `voisinParId`.
      const cible = voisinParId.get(c.contenuId)!;
      return {
        nouveauId: c.nouveauId,
        contenuId: c.contenuId,
        marque: (cible.projectId !== null ? nomParId.get(cible.projectId) : undefined) ?? "une marque liée",
        scheduledFor: cible.scheduledFor,
        pourquoi: c.pourquoi,
      };
    });
  } catch (err: any) {
    console.error(`[Liens] détection de collision en lot échouée pour le projet ${input.projectId}:`, err?.message);
    return [];
  }
}
