import { scrapeAsMarkdown } from "../brightdata-enrich";
import { callClaudeWithContext } from "../claude";
import type { Candidat } from "./triage";

export interface Fiche {
  factSummary: string;
  whyThisBrand: string;
  angle: string;
  question: string;
}

const MAX_CARACTERES_ARTICLE = 6000;
// Bornage de l'extrait journalisé quand le modèle répond mais que parseFiche échoue :
// assez pour diagnostiquer (accolades absentes, JSON tronqué, champ manquant), jamais
// la réponse entière dans les logs.
const EXTRAIT_LOG_MAX = 300;

export const PROMPT_FICHE = `Tu écris une fiche de lecture pour la fondatrice, sur UN article.

Quatre champs, et rien d'autre :
- "fait" : 2 à 3 lignes. Ce qui s'est passé. Sans emphase, sans adjectif de vente.
- "pourquoi" : le lien explicite avec le positionnement de CETTE marque. Si tu n'en trouves
  pas de précis, dis-le platement plutôt que d'en inventer un.
- "angle" : une prise possible — un TERRAIN, pas une opinion. Tu ne dis jamais ce qu'il faut
  penser : tu montres où il y aurait quelque chose à dire.
- "question" : UNE seule question, précise, ouverte, qui appelle un avis que SEULE elle peut
  donner, avec son expérience et sa position. Une question générique (« qu'en penses-tu ? »,
  « est-ce une bonne nouvelle ? ») est un échec : elle doit être impossible à poser à
  quelqu'un d'autre.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"fait": "...", "pourquoi": "...", "angle": "...", "question": "..."}`;

/** Lit la sortie du modèle. Pure. Un champ manquant ou vide invalide toute la fiche. */
export function parseFiche(raw: string): Fiche | null {
  if (!raw) return null;
  const debut = raw.indexOf("{");
  const fin = raw.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  let o: any;
  try { o = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  const champ = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fait = champ(o?.fait), pourquoi = champ(o?.pourquoi), angle = champ(o?.angle), question = champ(o?.question);
  if (!fait || !pourquoi || !angle || !question) return null;
  return { factSummary: fait, whyThisBrand: pourquoi, angle, question };
}

/**
 * Lit l'article pour de vrai, puis rédige. Le scrape est OBLIGATOIRE : une fiche écrite
 * depuis le seul titre est creuse, et une fiche creuse coûte plus cher que pas de fiche.
 * `scrape` est injectable pour les tests.
 */
export async function redigerFiche(input: {
  userId: string;
  candidat: Candidat & { score: number; rationale: string };
  scrape?: typeof scrapeAsMarkdown;
}): Promise<Fiche | null> {
  const scrape = input.scrape ?? scrapeAsMarkdown;
  const c = input.candidat;
  try {
    const page = await scrape(c.url, MAX_CARACTERES_ARTICLE);
    // Journalisé avec l'URL : c'est le cas de la presse payante, où le scrape rend une
    // page vide sans lever d'exception. Sans cette ligne, l'échec n'existe nulle part —
    // ni exception, ni fiche, ni compteur (le produit s'en interdit) — et le runner ne
    // peut pas non plus le distinguer d'un modèle qui répond mal. Le journal serveur est
    // le seul organe de détection de cette fonctionnalité.
    if (!page || !page.content || !page.content.trim()) {
      console.error(`[Lecture] article illisible (scrape sans contenu) : ${c.url}`);
      return null;
    }

    const raw = await callClaudeWithContext({
      userId: input.userId,
      projectId: c.projectId,
      model: undefined, // défaut = smart
      max_tokens: 1200,
      additionalSystemContext: PROMPT_FICHE,
      userMessage: `ARTICLE\nTitre : ${c.title}\nSource : ${c.source ?? "inconnue"}\nDate : ${c.publishedAt.toISOString().slice(0, 10)}\nURL : ${c.url}\n\nCONTENU\n${page.content}`,
    });
    const fiche = parseFiche(raw);
    // Best-effort : ceci est le cas le plus fréquent en production — le modèle a répondu,
    // mais mal (accolades absentes, JSON tronqué, champ manquant). Aucune exception n'est
    // levée ici, donc sans ce log explicite l'échec serait totalement invisible — cette
    // fonctionnalité s'interdit volontairement tout compteur et tout message visible,
    // ce qui fait du journal serveur le seul endroit où une défaillance peut encore se voir.
    if (!fiche) {
      console.error(
        `[Lecture] fiche illisible pour ${c.url} — extrait de la sortie du modèle :`,
        raw ? raw.slice(0, EXTRAIT_LOG_MAX) : "(vide)",
      );
    }
    return fiche;
  } catch (err: any) {
    console.error(`[Lecture] rédaction de fiche échouée pour ${c.url}:`, err?.message);
    return null;
  }
}
