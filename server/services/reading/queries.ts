import { db } from "../../db";
import { and, eq, desc } from "drizzle-orm";
import { readingQueries, projects, brandDna, type ReadingQuery } from "@shared/schema";
import { callClaude, CLAUDE_MODELS } from "../claude";
import { retrieveMemories } from "../memory/retrieve";
import { serpSearch } from "../serp";

// Options SERP de la veille : verticale actualités, fenêtre 7 jours, France — LES MÊMES
// que le sourcing (source.ts) et que la validation ci-dessous. Une requête validée avec
// des options différentes de celles utilisées ensuite pour la chercher ne prouverait rien.
const OPTIONS_SERP_VEILLE = { vertical: "news" as const, freshness: "week" as const, pays: "fr", langue: "fr" };

export const MAX_REQUETES_PAR_PROJET = 6;
export const REGENERATION_JOURS = 7;

/** Régénérer au plus une fois par semaine : sinon la veille change de sujet tous les matins. */
export function doitRegenerer(derniereGeneration: Date | null, today: Date): boolean {
  if (!derniereGeneration) return true;
  const jours = (today.getTime() - derniereGeneration.getTime()) / (24 * 3600 * 1000);
  return jours > REGENERATION_JOURS;
}

/** Lit la sortie du modèle : un tableau de chaînes. Pure, tolérante, plafonnée. */
export function parseRequetes(raw: string): string[] {
  if (!raw) return [];
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return [];
  let brut: any;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const out: string[] = [];
  for (const q of brut) {
    if (typeof q !== "string") continue;
    const s = q.trim();
    if (!s || vues.has(s)) continue;
    vues.add(s);
    out.push(s);
    if (out.length >= MAX_REQUETES_PAR_PROJET) break;
  }
  return out;
}

/**
 * Prompt réécrit sur mesure : une revue complète contre l'API réelle (Google Actualités,
 * via serpSearch) a montré que les requêtes générées par la version précédente rendaient
 * 0 résultat sur 24, alors que des requêtes manuelles sur les mêmes marques en rendaient
 * 5 sur 13. Ce qui séparait les deux : les requêtes qui marchent nomment un secteur, une
 * entreprise, une plateforme, un métier — ce dont un journaliste écrit — jamais un concept
 * de positionnement marketing. La date du jour est injectée pour que le modèle raisonne
 * sur l'actualité RÉELLE au moment de l'exécution, pas sur l'année de son entraînement
 * (constaté : il écrivait « 2025 » en écrivant, en fait, en 2026).
 */
function construirePromptRequetes(today: Date): string {
  const date = today.toISOString().slice(0, 10);
  return `Tu composes des requêtes de veille pour chercher l'ACTUALITÉ récente d'une marque,
via un moteur de recherche (verticale actualités, fenêtre de 7 jours, France).

Nous sommes le ${date}. Base-toi sur cette date pour raisonner sur ce qui est récent.
N'écris JAMAIS une année dans une requête : la fenêtre de recherche est déjà bornée aux
7 derniers jours — une année n'ajoute rien et EXCLUT des résultats qui la mentionnent
sous une autre forme (ou pas du tout).

Règles, mesurées empiriquement sur ce moteur de recherche :
- 2 à 4 mots par requête, jamais plus : au-delà, le moteur ne trouve plus rien.
- Nomme un SECTEUR, une ENTREPRISE, une PLATEFORME, un MÉTIER ou une INSTITUTION —
  ce dont un journaliste écrit un article — jamais un concept marketing ou de
  positionnement. Aucun média n'écrit d'article intitulé « personal branding
  entrepreneurs » ; beaucoup écrivent sur « les agences de communication ».
- Jamais d'année ni de mot comme « tendances », « 2025 », « 2026 » dans la requête.

Exemples mesurés qui FONCTIONNENT (rendent des résultats) :
- communication digitale agences
- agences de communication chiffre d'affaires
- creator economy France
- LinkedIn algorithme
- Instagram créateurs monétisation

Exemples mesurés qui ÉCHOUENT (zéro résultat) — à ne surtout pas imiter :
- personal branding entrepreneurs
- stratégie de contenu B2B
- marché du SaaS français
- OpenAI entreprises
- réglementation IA Europe
- freelances France marché
- personal branding fondateurs startups tendances 2025
- thought leadership créateurs contenu monétisation newsletter premium France
- outils de productivité IA pour entrepreneurs levée de fonds 2025

3 à 6 requêtes, en français, chacune visant un angle différent : deux requêtes qui
ramèneraient les mêmes articles sont une requête gâchée.

Réponds UNIQUEMENT par un tableau JSON de chaînes, sans texte autour : ["...", "..."]`;
}

/**
 * Rend les requêtes actives d'un projet, en les générant si elles manquent ou ont
 * plus d'une semaine. Chaque requête générée est validée UNE FOIS contre l'API SERP
 * réelle avant d'être persistée — une requête à 0 résultat ne doit jamais s'installer
 * sept jours en base. Best-effort : en cas d'échec de génération (ou si aucune requête
 * générée ne passe la validation), on rend ce qui existe déjà (éventuellement rien)
 * plutôt que de casser la revue.
 */
export async function assurerRequetes(userId: string, projectId: number, today: Date): Promise<string[]> {
  // Lecture protégée : une panne de base ici (connexion, timeout Neon) ne doit jamais
  // faire remonter d'exception — sans état existant fiable, on ne peut de toute façon
  // pas décider une régénération en sécurité (on ignorerait quelles requêtes sont
  // manuelles). On dégrade la revue (liste vide) plutôt que de la casser.
  let existantes: ReadingQuery[];
  try {
    existantes = await db
      .select()
      .from(readingQueries)
      .where(and(eq(readingQueries.userId, userId), eq(readingQueries.projectId, projectId), eq(readingQueries.isActive, true)))
      .orderBy(desc(readingQueries.createdAt));
  } catch (err: any) {
    console.error(`[Lecture] lecture des requêtes projet ${projectId} échouée:`, err?.message);
    return [];
  }

  // La cadence de régénération est pilotée UNIQUEMENT par les requêtes générées par l'IA :
  // sinon une requête manuelle récente (ajoutée ou éditée par l'utilisatrice) repousserait
  // indéfiniment la régénération, alors qu'elle ne doit que se préserver, jamais piloter le rythme.
  const generationsIA = existantes.filter((q) => q.origin === "ai");
  const derniereGeneration = generationsIA.reduce<Date | null>((max, q) => {
    const d = q.createdAt ? new Date(q.createdAt) : null;
    return d && (!max || d > max) ? d : max;
  }, null);

  // Les requêtes écrites à la main ne sont jamais remplacées par la génération.
  const manuelles = existantes.filter((q) => q.origin === "manual").map((q) => q.query);
  if (!doitRegenerer(derniereGeneration, today)) {
    return existantes.map((q) => q.query);
  }

  try {
    const [projet] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!projet) return existantes.map((q) => q.query);
    const adn = await db.select().from(brandDna).where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, projectId))).catch(() => []);
    const mem = await retrieveMemories(userId, projectId, `actualité du marché de ${projet.name}`).catch(() => null);
    const cap = mem?.cap?.map((m) => `- ${m.content}`).join("\n") ?? "";

    const contexte = [
      `Marque : ${projet.name}`,
      projet.type ? `Type : ${projet.type}` : "",
      projet.description ? `Description : ${projet.description}` : "",
      projet.statusNote ? `Où en est la marque : ${projet.statusNote}` : "",
      adn.length ? `ADN de marque : ${JSON.stringify(adn[0]).slice(0, 1500)}` : "",
      cap ? `Ce qui compte pour cette marque :\n${cap}` : "",
    ].filter(Boolean).join("\n");

    const raw = await callClaude({
      model: CLAUDE_MODELS.smart,
      taskKind: "strategic_reasoning",
      system: construirePromptRequetes(today),
      max_tokens: 800,
      userId,
      projectId,
      messages: [{ role: "user", content: contexte }],
    });

    const candidates = parseRequetes(raw).filter((q) => !manuelles.includes(q));
    if (candidates.length === 0) return existantes.map((q) => q.query);

    // Validation avant persistance : aucun prompt n'est fiable à 100 % (mesuré : 0/24
    // résultats avec l'ancien prompt). Une requête qui ne rend RIEN aujourd'hui s'installerait
    // sept jours en base et rendrait la veille silencieusement vide — on la teste UNE FOIS,
    // avec les mêmes options que le sourcing réel, et on n'écarte qu'elle, jamais la marque
    // entière. Coût négligeable (au plus 6 appels SERP par projet, par semaine).
    const valides: string[] = [];
    const ecartees: string[] = [];
    for (const q of candidates) {
      const resultats = await serpSearch(q, userId, OPTIONS_SERP_VEILLE);
      if (resultats.length > 0) valides.push(q);
      else ecartees.push(q);
    }
    if (ecartees.length > 0) {
      console.info(
        `[Lecture] validation des requêtes projet ${projectId} : ${ecartees.length}/${candidates.length} ` +
          `écartée(s) (0 résultat SERP) — ${ecartees.join(" | ")}`,
      );
    }
    // Pas de seconde tentative de génération ici : un journal explicite vaut mieux
    // qu'une boucle qui dépense en pariant sur un meilleur tirage.
    if (valides.length === 0) {
      console.warn(
        `[Lecture] aucune requête générée n'a survécu à la validation SERP pour le projet ${projectId} — ` +
          `rien n'est persisté, les requêtes actives existantes sont conservées telles quelles.`,
      );
      return existantes.map((q) => q.query);
    }

    // Les anciennes générées sortent, les manuelles restent. Transaction : si l'insert
    // échouait après l'update, le projet se retrouverait avec zéro requête active — le job
    // du lendemain ne trouverait plus rien à chercher pour cette marque.
    await db.transaction(async (tx) => {
      await tx
        .update(readingQueries)
        .set({ isActive: false })
        .where(and(eq(readingQueries.userId, userId), eq(readingQueries.projectId, projectId), eq(readingQueries.origin, "ai")));

      await tx.insert(readingQueries).values(
        valides.map((q) => ({ userId, projectId, query: q, origin: "ai" as const, isActive: true })),
      );
    });

    return [...manuelles, ...valides];
  } catch (err: any) {
    console.error(`[Lecture] génération de requêtes projet ${projectId} échouée:`, err?.message);
    return existantes.map((q) => q.query);
  }
}
