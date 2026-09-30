import { db } from "../../db";
import { and, eq, gte, lte, or, inArray } from "drizzle-orm";
import { projectLinks, content, projects } from "@shared/schema";
import { callClaude, CLAUDE_MODELS } from "../claude";

/** Fenêtre de comparaison autour de la date de programmation. */
export const FENETRE_JOURS = 7;
/** Plafond de contenus envoyés au jugement, pour borner le prompt. */
export const MAX_CONTENUS_COMPARES = 12;

export interface Collision {
  contenuId: number;
  marque: string;
  scheduledFor: Date | null;
  pourquoi: string;
}

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
{"collision": true, "contenuId": <identifiant>, "pourquoi": "<une phrase, en français>"}`;

/** Lit le verdict du modèle. Pure, tolérante. Une alerte sans cible est jetée. */
export function parseVerdict(raw: string): { contenuId: number; pourquoi: string } | null {
  if (!raw) return null;
  const debut = raw.indexOf("{");
  const fin = raw.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  let o: any;
  try { o = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  if (o?.collision !== true) return null;
  if (typeof o.contenuId !== "number" || !Number.isFinite(o.contenuId)) return null;
  return { contenuId: o.contenuId, pourquoi: typeof o.pourquoi === "string" ? o.pourquoi : "" };
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
    const liens = await db.select().from(projectLinks).where(and(
      eq(projectLinks.userId, input.userId),
      eq(projectLinks.audiencesRecoupent, true),
      or(eq(projectLinks.fromProjectId, input.projectId), eq(projectLinks.toProjectId, input.projectId)),
    ));
    if (liens.length === 0) return null;

    const autresIds = liens.map((l) => (l.fromProjectId === input.projectId ? l.toProjectId : l.fromProjectId));

    const debut = new Date(input.quand.getTime() - FENETRE_JOURS * 24 * 3600 * 1000);
    const finFenetre = new Date(input.quand.getTime() + FENETRE_JOURS * 24 * 3600 * 1000);

    const voisins = await db
      .select({
        id: content.id, title: content.title, body: content.body,
        projectId: content.projectId, scheduledFor: content.scheduledFor,
      })
      .from(content)
      .where(and(
        eq(content.userId, input.userId),
        // `content.projectId` est NULLABLE (vérifié dans le schéma) : `inArray` écarte
        // déjà les lignes nulles, mais on ne s'appuie pas sur ce détail de drizzle —
        // `autresIds` ne contient que des identifiants réels, donc un contenu sans
        // marque ne peut pas entrer dans la comparaison.
        inArray(content.projectId, autresIds),
        gte(content.scheduledFor, debut),
        lte(content.scheduledFor, finFenetre),
      ))
      // ORDER BY explicite : sans lui, QUELS contenus sont comparés quand le plafond
      // tombe dépend de l'ordre physique de Postgres, qui peut changer d'un jour à
      // l'autre — l'alerte deviendrait non déterministe.
      .orderBy(content.scheduledFor)
      .limit(MAX_CONTENUS_COMPARES);

    if (voisins.length === 0) return null;

    const liste = voisins
      .map((v) => `[${v.id}] ${v.title}\n${String(v.body ?? "").slice(0, 400)}`)
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
        content: `CONTENU QU'ON PROGRAMME\n${input.titre}\n${input.corps.slice(0, 800)}\n\nDÉJÀ PROGRAMMÉ SUR LA MARQUE LIÉE\n${liste}`,
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
