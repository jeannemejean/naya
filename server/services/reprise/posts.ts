// Reprise — les posts dont la date est passée sans qu'ils partent (spec 2026-10-26, § posts).
//
// Constaté le 26 oct. : neuf posts du 14 au 23 octobre, en brouillon ou prêts, restaient
// datés de la semaine passée. Personne ne décidait de leur sort : ni l'atelier (il ne voit
// que les posts à venir), ni la reprise des tâches. Naya décide désormais pour chacun :
// le reprogrammer dans les jours qui viennent s'il sert encore sa campagne, ou le retirer
// du calendrier (restaurable). Choix de Jeanne : elle décide seule, tout s'affiche le
// lendemain avec de quoi annuler.
import { z } from "zod/v4";
import { plusJours } from "@shared/atelier";

export const SCHEMA_POSTS = z.object({
  posts: z.array(z.object({
    id: z.number().int(),
    action: z.enum(["reprogrammer", "retirer"]),
    jour: z.string().nullable(),
    raison: z.string(),
  })),
});
export type SortiePosts = z.infer<typeof SCHEMA_POSTS>;

export interface PostManque {
  id: number;
  title: string;
  platform?: string | null;
  campaignId?: number | null;
  scheduledFor: Date | string;
  contentStatus?: string | null;
}

export interface Campagne { name: string; startDate?: string | null; endDate?: string | null }

export interface DecisionPost { id: number; action: "reprogrammer" | "retirer"; jour: string | null; raison: string }

const STATUTS_PARTIS = ["posted", "uploading", "processing", "posting"];
const jourValide = (j: unknown): j is string => typeof j === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j) && !Number.isNaN(Date.parse(j));
const plateforme = (p?: string | null) => (p ?? "").trim().toLowerCase();

/** Un post daté d'avant `jusquA` (jour Paris compris) qui n'est jamais parti. PUR. */
export function estPostManque(
  p: { scheduledFor?: Date | string | null; publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null },
  jourDuPost: string, jusquA: string,
): boolean {
  if (!p.scheduledFor || (p.publishedAt !== null && p.publishedAt !== undefined)) return false;
  if (STATUTS_PARTIS.includes((p.postStatus ?? "").trim().toLowerCase())) return false;
  if ((p.contentStatus ?? "").trim().toLowerCase() === "published") return false;
  return jourDuPost <= jusquA;
}

/**
 * Une décision par post, exactement ; le jour de chaque post reprogrammé. PUR.
 * - pas d'avis, ou id oublié → reprogrammé ;
 * - jour absent, invalide, avant `cible` ou après `fin` → Naya lui en trouve un ;
 * - deux posts de la même plateforme ne tombent pas le même jour (ni sur un post déjà prévu) :
 *   le second glisse au jour suivant libre.
 */
export function deciderJoursPosts({ posts, sortie, cible, fin, dejaPrevus, jourDe, estTravaille = () => true }: {
  posts: PostManque[];
  sortie: SortiePosts | null;
  cible: string;
  fin: string;
  /** Posts à venir déjà au calendrier : leur plateforme et leur jour. */
  dejaPrevus: Array<{ platform?: string | null; jour: string }>;
  jourDe: (p: PostManque) => string;
  /** Jours où un post peut sortir (les jours travaillés : tes séries sortent en semaine). */
  estTravaille?: (d: string) => boolean;
}): DecisionPost[] {
  const avis = new Map((sortie?.posts ?? []).map((d) => [d.id, d]));
  const occupes = new Set(dejaPrevus.map((p) => `${plateforme(p.platform)}|${p.jour}`));
  // Dans l'ordre où ils devaient sortir : la série garde son ordre.
  const ordre = [...posts].sort((a, b) => jourDe(a).localeCompare(jourDe(b)) || a.id - b.id);
  return ordre.map((p) => {
    const d = avis.get(p.id);
    const raison = (d?.raison ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (d?.action === "retirer") return { id: p.id, action: "retirer" as const, jour: null, raison };
    // Le temps de le produire : un brouillon passe par l'atelier puis la validation (deux
    // jours), un post déjà validé peut sortir le lendemain. Essai du 26 oct. : reprogrammés
    // le jour même, les posts redevenaient « manqués » le soir.
    const auPlusTot = plusJours(cible, p.contentStatus === "ready" ? 1 : 2);
    let jour = jourValide(d?.jour) && d!.jour! >= auPlusTot && d!.jour! <= fin ? d!.jour! : auPlusTot;
    for (let i = 0; i < 60 && (!estTravaille(jour) || occupes.has(`${plateforme(p.platform)}|${jour}`)); i++) jour = plusJours(jour, 1);
    occupes.add(`${plateforme(p.platform)}|${jour}`);
    return { id: p.id, action: "reprogrammer" as const, jour, raison };
  });
}

export const SYSTEME_POSTS = [
  "Tu es Naya. Des posts de l'utilisatrice devaient sortir et ne sont jamais partis : leur date est passée. Pour chacun, décide :",
  "- reprogrammer : il sert encore sa campagne et son objectif ; donne le jour (AAAA-MM-JJ) où il sort, dans la fenêtre donnée (un jour de semaine ; deux jours au moins après le début de la fenêtre pour un brouillon, le temps de l'écrire), en gardant l'ordre de la série et en respectant la fin de la campagne ;",
  "- retirer : son moment est passé (un sujet daté, une fête finie, une annonce dépassée), il fait doublon avec ce qui est prévu, ou sa campagne est finie.",
  "Un post de saison (Halloween, rentrée…) se reprogramme seulement s'il peut encore sortir avant la date qui lui donne son sens.",
  "Ne surcharge pas : au plus un post par plateforme et par jour, en tenant compte de ce qui est déjà prévu.",
  "raison : une phrase, en tutoyant (ex. « Toujours utile pour la campagne : je l'ai décalé à jeudi. »).",
].join("\n");

const jourFr = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function promptPosts({ aujourdhui, cible, fin, posts, campagnes, dejaPrevus, jourDe }: {
  aujourdhui: string; cible: string; fin: string;
  posts: PostManque[]; campagnes: Map<number, Campagne>;
  dejaPrevus: Array<{ title?: string | null; platform?: string | null; jour: string }>;
  jourDe: (p: PostManque) => string;
}): string {
  const campagne = (id?: number | null) => {
    const c = id != null ? campagnes.get(id) : undefined;
    return c ? `campagne « ${c.name} »${c.endDate ? ` (jusqu'au ${c.endDate})` : ""}` : "hors campagne";
  };
  return [
    `Aujourd'hui : ${jourFr(aujourdhui)} (${aujourdhui}). Fenêtre pour reprogrammer : du ${cible} au ${fin}.`,
    "",
    "## Posts jamais partis",
    ...posts.map((p) => `#${p.id} ${p.title} — ${p.platform ?? "?"}, prévu le ${jourDe(p)}, ${campagne(p.campaignId)}, ${p.contentStatus === "ready" ? "validé" : "brouillon"}`),
    "",
    "## Déjà prévu dans la fenêtre",
    ...(dejaPrevus.length ? dejaPrevus.map((p) => `- ${p.jour} · ${p.platform ?? "?"} · ${p.title ?? ""}`) : ["(rien)"]),
  ].join("\n");
}

