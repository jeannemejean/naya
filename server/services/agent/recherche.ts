// Recherche de l'agent omniscient dans les données de l'utilisatrice, et lecture complète
// d'un élément trouvé. Ici, la recherche PAR MOTS : chaque source est interrogée avec
// `unaccent(col) ILIKE ANY (array[unaccent('%mot%'), …])`, toujours bornée à l'utilisatrice.
// La recherche PAR SENS (embeddings de `recherche_embeddings` et de `memory_entries`, tenus à
// jour par l'indexeur) se fond dans `chercher` ; si elle échoue, les mots suffisent.
//
// Sécurité : la requête de l'utilisatrice n'entre en SQL que comme paramètre lié (gabarit
// `sql` de drizzle), jamais concaténée ; `%`, `_` et `\` sont échappés pour ILIKE.
import { depot } from "./depot";
import { notesPourMessages } from "./historique";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "../../db";
import { embedText, toVectorLiteral } from "../memory/embed";
import {
  companionConversations,
  content,
  inboxConversations,
  inboxMessages,
  leads,
  livrables,
  memoryEntries,
  projects,
  quickCaptureEntries,
  taskWorkspaceEntries,
  tasks,
} from "@shared/schema";

export type SourceRecherche =
  | "tache_reponse" | "livrable" | "note" | "memoire" | "conversation" | "contenu" | "tache" | "reponse_prospect";

export const SOURCES: SourceRecherche[] = [
  "tache_reponse", "livrable", "note", "memoire", "conversation", "contenu", "tache", "reponse_prospect",
];

export interface FiltresRecherche {
  projetId?: number;
  depuis?: string; // YYYY-MM-DD, inclus
  jusqua?: string; // YYYY-MM-DD, inclus
  sources?: SourceRecherche[];
}

export interface Trouvaille {
  source: SourceRecherche;
  id: number;
  date: string; // ISO
  titre: string;
  projet: string | null;
  extrait: string;
  score: number;
}

// Forme de la recherche par sens (injectable pour les tests).
export type ChercherParSens = (userId: string, requete: string, filtres: FiltresRecherche) => Promise<Trouvaille[]>;

const MOTS_MAX = 8;
const LIGNES_PAR_SOURCE = 30;
const RESULTATS_MAX = 12;
const TAILLE_EXTRAIT = 240;
const SENS_PROCHES = 15; // recherche_embeddings
const SENS_MEMOIRE = 10; // memory_entries
const SENS_SCORE_MIN = 0.35;
// Sources dont le texte est embeddé par l'indexeur (jamais les messages des prospects).
const SOURCES_INDEXEES: SourceRecherche[] = ["tache_reponse", "livrable", "note", "conversation"];

// ── Logique pure ──────────────────────────────────────────────────────────────────────

// Minuscules sans accents, caractère par caractère : la longueur est conservée, pour que
// les positions trouvées dans le texte normalisé valent aussi dans le texte d'origine.
export function normaliser(texte: string): string {
  let out = "";
  for (const c of texte) {
    const n = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += n.length === c.length ? n : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }
  return out;
}

// Mots de 3 lettres ou plus, sans accents, dédoublonnés, au plus 8.
export function extraireMots(requete: string): string[] {
  const mots = normaliser(requete).split(/[^\p{L}\p{N}]+/u).filter((m) => m.length >= 3);
  return Array.from(new Set(mots)).slice(0, MOTS_MAX);
}

// Motif ILIKE « contient », jokers de l'utilisatrice neutralisés (échappement par défaut : \).
export function motifIlike(mot: string): string {
  return `%${mot.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function calculerScore(texte: string, mots: string[]): number {
  if (mots.length === 0) return 0;
  const n = normaliser(texte);
  return mots.filter((m) => n.includes(m)).length / mots.length;
}

// 240 caractères autour de la première occurrence d'un des mots (accents et casse ignorés).
export function extraireAutour(texte: string, mots: string[]): string {
  const propre = texte.replace(/\s+/g, " ").trim();
  if (propre.length <= TAILLE_EXTRAIT) return propre;
  const n = normaliser(propre);
  const positions = mots.map((m) => n.indexOf(m)).filter((p) => p >= 0);
  const premiere = positions.length ? Math.min(...positions) : 0;
  const debut = Math.max(0, Math.min(premiere - Math.floor(TAILLE_EXTRAIT / 3), propre.length - TAILLE_EXTRAIT));
  const fin = debut + TAILLE_EXTRAIT;
  return `${debut > 0 ? "…" : ""}${propre.slice(debut, fin)}${fin < propre.length ? "…" : ""}`;
}

// Score décroissant, puis date décroissante ; au plus 12.
export function trierEtCouper(trouvailles: Trouvaille[]): Trouvaille[] {
  return [...trouvailles]
    .sort((a, b) => b.score - a.score || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, RESULTATS_MAX);
}

// YYYY-MM-DD strict et date de calendrier réelle. Une date venue du modèle IA qui ne passe
// pas est ignorée plutôt que d'aller en SQL et de faire échouer toute la recherche.
export function dateValide(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, j] = s.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

function dateIso(d: unknown): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(String(d));
  return isNaN(date.getTime()) ? "" : date.toISOString();
}

function debutDe(texte: string, n = 80): string {
  const propre = texte.replace(/\s+/g, " ").trim();
  return propre.length > n ? `${propre.slice(0, n)}…` : propre;
}

// ── Requêtes par source ───────────────────────────────────────────────────────────────

interface LigneTrouvee {
  id: number;
  date: Date | string | null;
  titre: string | null;
  projet: string | null;
  texte: string | null;
}

interface DefinitionSource {
  colDate: SQL | PgColumn;
  colProjet: SQL | PgColumn | null; // null : source sans projet, exclue quand on filtre par projet
  texte: SQL; // texte cherché (colonnes concaténées)
  titre: (l: LigneTrouvee) => string;
  // Construit la requête avec la condition complète ; la 1re condition est toujours l'utilisatrice.
  requete: (champs: { id: any; date: any; titre: any; projet: any; texte: any }, ou: SQL) => Promise<LigneTrouvee[]>;
  cloison: (userId: string) => SQL[];
}

const joindre = (...cols: (PgColumn | SQL)[]): SQL =>
  sql.join(cols.map((c) => sql`coalesce(${c}, '')`), sql` || ' ' || `);

// Date d'un livrable / d'un contenu : la même expression sert au filtre et au tri, nuls en
// dernier, pour que des lignes sans date ne prennent pas la place des 30 plus récentes.
const DATE_LIVRABLE = sql`coalesce(${livrables.updatedAt}, ${livrables.createdAt})`;
const DATE_CONTENU = sql`coalesce(${content.updatedAt}, ${content.createdAt})`;

const DEFINITIONS: Record<SourceRecherche, DefinitionSource> = {
  tache_reponse: {
    colDate: taskWorkspaceEntries.updatedAt,
    colProjet: sql`coalesce(${taskWorkspaceEntries.projectId}, ${tasks.projectId})`,
    texte: joindre(taskWorkspaceEntries.content),
    titre: (l) => l.titre ?? "Tâche",
    cloison: (u) => [eq(taskWorkspaceEntries.userId, u)],
    requete: (c, ou) => db.select({ ...c, titre: tasks.title }).from(taskWorkspaceEntries)
      .innerJoin(tasks, eq(tasks.id, taskWorkspaceEntries.taskId))
      .leftJoin(projects, eq(projects.id, sql`coalesce(${taskWorkspaceEntries.projectId}, ${tasks.projectId})`))
      .where(ou).orderBy(desc(taskWorkspaceEntries.updatedAt)).limit(LIGNES_PAR_SOURCE),
  },
  livrable: {
    colDate: DATE_LIVRABLE,
    colProjet: livrables.projectId,
    texte: joindre(livrables.content, livrables.taskTitle, livrables.fileName),
    titre: (l) => l.titre ?? "Livrable",
    cloison: (u) => [eq(livrables.userId, u)],
    requete: (c, ou) => db.select({ ...c, titre: sql<string | null>`coalesce(${livrables.taskTitle}, ${livrables.fileName})` })
      .from(livrables).leftJoin(projects, eq(projects.id, livrables.projectId))
      .where(ou).orderBy(sql`${DATE_LIVRABLE} desc nulls last`).limit(LIGNES_PAR_SOURCE),
  },
  note: {
    colDate: quickCaptureEntries.createdAt,
    colProjet: quickCaptureEntries.projectId,
    texte: joindre(quickCaptureEntries.content),
    titre: (l) => `Note : ${debutDe(l.texte ?? "", 60)}`,
    cloison: (u) => [eq(quickCaptureEntries.userId, u)],
    requete: (c, ou) => db.select(c).from(quickCaptureEntries)
      .leftJoin(projects, eq(projects.id, quickCaptureEntries.projectId))
      .where(ou).orderBy(desc(quickCaptureEntries.createdAt)).limit(LIGNES_PAR_SOURCE),
  },
  memoire: {
    colDate: memoryEntries.createdAt,
    colProjet: memoryEntries.projectId,
    texte: joindre(memoryEntries.content),
    titre: (l) => `Mémoire (${l.titre ?? "fait"}) : ${debutDe(l.texte ?? "", 60)}`,
    // Une entrée périmée est invalidée, pas supprimée : elle ne doit plus sortir.
    cloison: (u) => [eq(memoryEntries.userId, u), isNull(memoryEntries.supersededAt)],
    requete: (c, ou) => db.select({ ...c, titre: memoryEntries.entryType }).from(memoryEntries)
      .leftJoin(projects, eq(projects.id, memoryEntries.projectId))
      .where(ou).orderBy(desc(memoryEntries.createdAt)).limit(LIGNES_PAR_SOURCE),
  },
  conversation: {
    colDate: companionConversations.createdAt,
    colProjet: null,
    texte: joindre(companionConversations.content),
    titre: (l) => (l.titre === "user" ? "Tu as dit à Naya" : "Naya t'a répondu"),
    cloison: (u) => [eq(companionConversations.userId, u)],
    requete: (c, ou) => db.select({ ...c, titre: companionConversations.role, projet: sql<null>`null` })
      .from(companionConversations)
      .where(ou).orderBy(desc(companionConversations.createdAt)).limit(LIGNES_PAR_SOURCE),
  },
  contenu: {
    colDate: DATE_CONTENU,
    colProjet: content.projectId,
    texte: joindre(content.title, content.body),
    titre: (l) => l.titre ?? "Contenu",
    cloison: (u) => [eq(content.userId, u)],
    requete: (c, ou) => db.select({ ...c, titre: content.title }).from(content)
      .leftJoin(projects, eq(projects.id, content.projectId))
      .where(ou).orderBy(sql`${DATE_CONTENU} desc nulls last`).limit(LIGNES_PAR_SOURCE),
  },
  tache: {
    colDate: tasks.createdAt,
    colProjet: tasks.projectId,
    texte: joindre(tasks.title, tasks.description),
    titre: (l) => l.titre ?? "Tâche",
    cloison: (u) => [eq(tasks.userId, u)],
    requete: (c, ou) => db.select({ ...c, titre: tasks.title }).from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(ou).orderBy(desc(tasks.createdAt)).limit(LIGNES_PAR_SOURCE),
  },
  reponse_prospect: {
    colDate: inboxMessages.sentAt,
    colProjet: inboxConversations.projectId,
    texte: joindre(inboxMessages.subject, inboxMessages.body),
    titre: (l) => `Échange avec ${l.titre ?? "un prospect"}`,
    // inbox_messages n'a pas de user_id : le cloisonnement passe par la conversation.
    cloison: (u) => [eq(inboxConversations.userId, u)],
    requete: (c, ou) => db.select({ ...c, titre: leads.name }).from(inboxMessages)
      .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
      .leftJoin(leads, eq(leads.id, inboxConversations.leadId))
      .leftJoin(projects, eq(projects.id, inboxConversations.projectId))
      .where(ou).orderBy(desc(inboxMessages.sentAt)).limit(LIGNES_PAR_SOURCE),
  },
};

// Identifiant de chaque source (colonne `id` de la table principale).
const COL_ID: Record<SourceRecherche, PgColumn> = {
  tache_reponse: taskWorkspaceEntries.id,
  livrable: livrables.id,
  note: quickCaptureEntries.id,
  memoire: memoryEntries.id,
  conversation: companionConversations.id,
  contenu: content.id,
  tache: tasks.id,
  reponse_prospect: inboxMessages.id,
};

// Cloison de l'utilisatrice + condition propre à la recherche (mots, ou ids trouvés par sens)
// + filtres. Les dates invalides sont ignorées.
function conditionsDe(userId: string, source: SourceRecherche, condition: SQL, filtres: FiltresRecherche): SQL | undefined {
  const d = DEFINITIONS[source];
  const conds: SQL[] = [...d.cloison(userId), condition];
  if (dateValide(filtres.depuis)) conds.push(sql`${d.colDate} >= ${filtres.depuis}::date`);
  if (dateValide(filtres.jusqua)) conds.push(sql`${d.colDate} < (${filtres.jusqua}::date + interval '1 day')`);
  if (filtres.projetId != null && d.colProjet) conds.push(sql`${d.colProjet} = ${filtres.projetId}`);
  return and(...conds);
}

function conditionMots(source: SourceRecherche, mots: string[]): SQL {
  const motifs = sql.join(mots.map((m) => sql`unaccent(${motifIlike(m)})`), sql`, `);
  return sql`unaccent(${DEFINITIONS[source].texte}) ilike any(array[${motifs}])`;
}

// Sources à interroger : celles demandées (toutes par défaut) ; filtrer par projet exclut
// les sources qui n'en ont pas.
function sourcesDe(filtres: FiltresRecherche): SourceRecherche[] {
  return (filtres.sources?.length ? filtres.sources : SOURCES)
    .filter((s) => filtres.projetId == null || DEFINITIONS[s].colProjet !== null);
}

function champsDe(source: SourceRecherche) {
  return {
    id: COL_ID[source],
    date: DEFINITIONS[source].colDate,
    titre: sql<string | null>`null`,
    projet: projects.name,
    texte: DEFINITIONS[source].texte,
  };
}

export async function chercherParMots(userId: string, requete: string, filtres: FiltresRecherche): Promise<Trouvaille[]> {
  const mots = extraireMots(requete);
  if (mots.length === 0) return [];
  const parSource = await Promise.all(sourcesDe(filtres).map(async (source) => {
    const d = DEFINITIONS[source];
    const lignes = await d.requete(champsDe(source), conditionsDe(userId, source, conditionMots(source, mots), filtres)!);
    return lignes.map((l): Trouvaille => {
      const texte = l.texte ?? "";
      // Postgres a trouvé la ligne : au moins un mot y est, même si la normalisation JS
      // (ligatures, etc.) diverge de unaccent.
      const score = calculerScore(texte, mots) || 1 / mots.length;
      return {
        source, id: l.id, date: dateIso(l.date), titre: d.titre(l), projet: l.projet ?? null,
        extrait: extraireAutour(texte, mots), score,
      };
    });
  }));
  return trierEtCouper(parSource.flat());
}

// Recherche par sens : la requête est embeddée, puis, en une requête, les 15 plus proches de
// `recherche_embeddings` et les 10 plus proches de `memory_entries` (non périmées). Les lignes
// sources sont relues (titre, extrait, filtres, cloison) ; score = 1 - distance cosinus, sous
// 0.35 ignoré. Sans embedding (pas de clé, service en panne) : [].
export const chercherParSens: ChercherParSens = async (userId, requete, filtres) => {
  const sources = sourcesDe(filtres);
  const indexees = SOURCES_INDEXEES.filter((s) => sources.includes(s));
  const avecMemoire = sources.includes("memoire");
  if (indexees.length === 0 && !avecMemoire) return [];

  const vecteur = await embedText(requete);
  if (!vecteur) return [];
  const vec = toVectorLiteral(vecteur);

  const parties: SQL[] = [];
  if (indexees.length > 0) {
    parties.push(sql`(SELECT r.source, r.source_id AS id, r.embedding <=> ${vec}::vector AS distance
      FROM recherche_embeddings r
      WHERE r.user_id = ${userId} AND r.embedding IS NOT NULL
        AND r.source IN (${sql.join(indexees.map((s) => sql`${s}`), sql`, `)})
      ORDER BY r.embedding <=> ${vec}::vector ASC
      LIMIT ${SENS_PROCHES})`);
  }
  if (avecMemoire) {
    parties.push(sql`(SELECT 'memoire' AS source, m.id, m.embedding <=> ${vec}::vector AS distance
      FROM memory_entries m
      WHERE m.user_id = ${userId} AND m.superseded_at IS NULL AND m.embedding IS NOT NULL
      ORDER BY m.embedding <=> ${vec}::vector ASC
      LIMIT ${SENS_MEMOIRE})`);
  }
  const res: any = await db.execute(sql.join(parties, sql` UNION ALL `));
  const proches = ((res.rows ?? res) as { source: SourceRecherche; id: number; distance: number }[])
    .map((p) => ({ source: p.source, id: Number(p.id), score: 1 - Number(p.distance) }))
    .filter((p) => p.score >= SENS_SCORE_MIN && sources.includes(p.source));
  if (proches.length === 0) return [];

  const mots = extraireMots(requete);
  const parSource = new Map<SourceRecherche, Map<number, number>>();
  for (const p of proches) {
    if (!parSource.has(p.source)) parSource.set(p.source, new Map());
    parSource.get(p.source)!.set(p.id, p.score);
  }
  const relues = await Promise.all(Array.from(parSource.entries()).map(async ([source, scores]) => {
    const d = DEFINITIONS[source];
    const ids = Array.from(scores.keys());
    // Relecture bornée à l'utilisatrice et aux filtres : un embedding orphelin ou hors filtre ne sort pas.
    const lignes = await d.requete(champsDe(source), conditionsDe(userId, source, inArray(COL_ID[source], ids), filtres)!);
    return lignes.map((l): Trouvaille => ({
      source, id: l.id, date: dateIso(l.date), titre: d.titre(l), projet: l.projet ?? null,
      extrait: extraireAutour(l.texte ?? "", mots), score: scores.get(l.id) ?? 0,
    }));
  }));
  return trierEtCouper(relues.flat());
};

// Fusion : un même élément trouvé par mots et par sens n'apparaît qu'une fois, avec le score
// le plus haut (l'extrait par mots est gardé, il est centré sur les mots cherchés).
export function fusionner(parMots: Trouvaille[], parSens: Trouvaille[]): Trouvaille[] {
  const parCle = new Map<string, Trouvaille>();
  for (const t of parMots) parCle.set(`${t.source}:${t.id}`, t);
  for (const t of parSens) {
    const cle = `${t.source}:${t.id}`;
    const deja = parCle.get(cle);
    parCle.set(cle, deja ? { ...deja, score: Math.max(deja.score, t.score) } : t);
  }
  return trierEtCouper(Array.from(parCle.values()));
}

// Recherche complète : par mots et par sens, en parallèle. Si la recherche par sens lève ou
// ne rend rien (pas de clé OpenAI, embeddings en panne), les résultats par mots suffisent.
export async function chercher(
  userId: string,
  requete: string,
  filtres: FiltresRecherche,
  deps?: { parSens?: ChercherParSens },
): Promise<Trouvaille[]> {
  const parSens = deps?.parSens ?? chercherParSens;
  const [mots, sens] = await Promise.all([
    chercherParMots(userId, requete, filtres),
    Promise.resolve().then(() => parSens(userId, requete, filtres)).catch((e: any) => {
      console.error("[recherche] par sens indisponible :", e?.message ?? e);
      return [] as Trouvaille[];
    }),
  ]);
  return annoterConversations(userId, fusionner(mots, sens));
}

// Un message de Naya dont une action a été annulée depuis le dit (sinon l'agent croit qu'elle existe).
async function annoterConversations(userId: string, trouvailles: Trouvaille[]): Promise<Trouvaille[]> {
  const ids = trouvailles.filter((t) => t.source === "conversation").map((t) => t.id);
  if (ids.length === 0) return trouvailles;
  try {
    const lignes = await db.select({ id: companionConversations.id, actions: companionConversations.actions })
      .from(companionConversations)
      .where(and(eq(companionConversations.userId, userId), inArray(companionConversations.id, ids)));
    const notes = await notesPourMessages(userId, lignes, (u, i) => depot.actionsAnnulees(u, i));
    const parId = new Map(lignes.map((l, k) => [l.id, notes[k]]));
    return trouvailles.map((t) => {
      const n = t.source === "conversation" ? parId.get(t.id) : undefined;
      return n && n.length ? { ...t, extrait: `${t.extrait}\n${n.join("\n")}` } : t;
    });
  } catch {
    return trouvailles;
  }
}

// ── Lecture complète d'un élément ─────────────────────────────────────────────────────

export interface Lecture { titre: string; date: string; projet: string | null; contenu: string }

const jour = (d: unknown) => dateIso(d).slice(0, 10);

export async function lire(userId: string, source: SourceRecherche, id: number): Promise<Lecture | null> {
  switch (source) {
    case "tache_reponse": {
      const [entree] = await db.select({ id: taskWorkspaceEntries.id, taskId: taskWorkspaceEntries.taskId })
        .from(taskWorkspaceEntries)
        .where(and(eq(taskWorkspaceEntries.userId, userId), eq(taskWorkspaceEntries.id, id))).limit(1);
      if (!entree) return null;
      const [tache] = await db.select({
        title: tasks.title, scheduledDate: tasks.scheduledDate, dueDate: tasks.dueDate, projet: projects.name,
      }).from(tasks).leftJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.userId, userId), eq(tasks.id, entree.taskId))).limit(1);
      if (!tache) return null;
      const reponses = await db.select({ content: taskWorkspaceEntries.content, updatedAt: taskWorkspaceEntries.updatedAt })
        .from(taskWorkspaceEntries)
        .where(and(eq(taskWorkspaceEntries.userId, userId), eq(taskWorkspaceEntries.taskId, entree.taskId)))
        .orderBy(asc(taskWorkspaceEntries.createdAt));
      const prevue = tache.scheduledDate ?? (tache.dueDate ? jour(tache.dueDate) : null);
      const derniere = reponses[reponses.length - 1]?.updatedAt;
      return {
        titre: tache.title,
        date: dateIso(derniere),
        projet: tache.projet ?? null,
        contenu: [
          `Tâche : ${tache.title}`,
          `Date prévue : ${prevue ?? "non planifiée"}`,
          ...reponses.map((r) => `— Réponse du ${jour(r.updatedAt)} :\n${r.content}`),
        ].join("\n\n"),
      };
    }
    case "livrable": {
      const [l] = await db.select({ l: livrables, projet: projects.name }).from(livrables)
        .leftJoin(projects, eq(projects.id, livrables.projectId))
        .where(and(eq(livrables.userId, userId), eq(livrables.id, id))).limit(1);
      if (!l) return null;
      const titre = l.l.taskTitle ?? l.l.fileName ?? "Livrable";
      const corps = [l.l.content, l.l.url ? `Lien : ${l.l.url}` : null].filter(Boolean).join("\n\n");
      return { titre, date: dateIso(l.l.updatedAt ?? l.l.createdAt), projet: l.projet ?? null, contenu: `Livrable de « ${titre} » (${l.l.kind})\n\n${corps}` };
    }
    case "note": {
      const [n] = await db.select({ n: quickCaptureEntries, projet: projects.name }).from(quickCaptureEntries)
        .leftJoin(projects, eq(projects.id, quickCaptureEntries.projectId))
        .where(and(eq(quickCaptureEntries.userId, userId), eq(quickCaptureEntries.id, id))).limit(1);
      if (!n) return null;
      return { titre: `Note : ${debutDe(n.n.content, 60)}`, date: dateIso(n.n.createdAt), projet: n.projet ?? null, contenu: n.n.content };
    }
    case "memoire": {
      const [m] = await db.select({ m: memoryEntries, projet: projects.name }).from(memoryEntries)
        .leftJoin(projects, eq(projects.id, memoryEntries.projectId))
        .where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.id, id))).limit(1);
      if (!m) return null;
      const perime = m.m.supersededAt ? `\n\n(Périmée depuis le ${jour(m.m.supersededAt)})` : "";
      return { titre: `Mémoire (${m.m.entryType})`, date: dateIso(m.m.createdAt), projet: m.projet ?? null, contenu: `${m.m.content}${perime}` };
    }
    case "conversation": {
      const [c] = await db.select().from(companionConversations)
        .where(and(eq(companionConversations.userId, userId), eq(companionConversations.id, id))).limit(1);
      if (!c) return null;
      const titre = c.role === "user" ? "Tu as dit à Naya" : "Naya t'a répondu";
      const [notes] = await notesPourMessages(userId, [c], (u, i) => depot.actionsAnnulees(u, i)).catch(() => [[] as string[]]);
      return { titre, date: dateIso(c.createdAt), projet: null, contenu: notes?.length ? `${c.content}\n${notes.join("\n")}` : c.content };
    }
    case "contenu": {
      const [c] = await db.select({ c: content, projet: projects.name }).from(content)
        .leftJoin(projects, eq(projects.id, content.projectId))
        .where(and(eq(content.userId, userId), eq(content.id, id))).limit(1);
      if (!c) return null;
      const quand = c.c.publishedAt ? `Publié le ${jour(c.c.publishedAt)}` : c.c.scheduledFor ? `Prévu le ${jour(c.c.scheduledFor)}` : `Statut : ${c.c.status}`;
      return {
        titre: c.c.title, date: dateIso(c.c.updatedAt ?? c.c.createdAt), projet: c.projet ?? null,
        contenu: `${c.c.title} (${c.c.platform}) — ${quand}\n\n${c.c.body}`,
      };
    }
    case "tache": {
      const [t] = await db.select({ t: tasks, projet: projects.name }).from(tasks)
        .leftJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.userId, userId), eq(tasks.id, id))).limit(1);
      if (!t) return null;
      const prevue = t.t.scheduledDate ?? (t.t.dueDate ? jour(t.t.dueDate) : null);
      return {
        titre: t.t.title, date: dateIso(t.t.createdAt), projet: t.projet ?? null,
        contenu: [
          `Tâche : ${t.t.title}`,
          `Date prévue : ${prevue ?? "non planifiée"}`,
          `État : ${t.t.completed ? "faite" : "à faire"}`,
          t.t.description ? `Description :\n${t.t.description}` : null,
        ].filter(Boolean).join("\n\n"),
      };
    }
    case "reponse_prospect": {
      // Le message n'a pas de user_id : on le retrouve à travers la conversation de l'utilisatrice.
      const [m] = await db.select({ conversationId: inboxMessages.conversationId, sentAt: inboxMessages.sentAt, prospect: leads.name, projet: projects.name, canal: inboxConversations.channel })
        .from(inboxMessages)
        .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
        .leftJoin(leads, eq(leads.id, inboxConversations.leadId))
        .leftJoin(projects, eq(projects.id, inboxConversations.projectId))
        .where(and(eq(inboxConversations.userId, userId), eq(inboxMessages.id, id))).limit(1);
      if (!m) return null;
      const fil = await db.select({ sens: inboxMessages.sens, subject: inboxMessages.subject, body: inboxMessages.body, sentAt: inboxMessages.sentAt })
        .from(inboxMessages)
        .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
        .where(and(eq(inboxConversations.userId, userId), eq(inboxMessages.conversationId, m.conversationId)))
        .orderBy(asc(inboxMessages.sentAt));
      const prospect = m.prospect ?? "un prospect";
      return {
        titre: `Échange avec ${prospect}`, date: dateIso(m.sentAt), projet: m.projet ?? null,
        contenu: [
          `Échange avec ${prospect} (${m.canal})`,
          ...fil.map((x) => `— ${x.sens === "entrant" ? prospect : "Toi"}, le ${jour(x.sentAt)}${x.subject ? ` — ${x.subject}` : ""} :\n${x.body}`),
        ].join("\n\n"),
      };
    }
  }
}
