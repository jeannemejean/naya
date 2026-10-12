/**
 * Pré-remplissage de la bibliothèque de preuves : Naya lit le site du projet, ses posts
 * publiés et le savoir déposé, et en tire des preuves PROPOSÉES. Jamais validées d'office,
 * jamais citables d'office, et uniquement ce qui figure explicitement dans les textes.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { memoryEntries } from "@shared/schema";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { scrapeAsMarkdown, webScrapeConfigured } from "../brightdata-enrich";
import { dedoublonnerPropositions, parsePropositions } from "./preuves";

type Source = "site" | "post" | "document";

async function lireSources(userId: string, projectId: number): Promise<{ textes: Array<{ source: Source; texte: string }>; echecs: string[] }> {
  const textes: Array<{ source: Source; texte: string }> = [];
  const echecs: string[] = [];

  try {
    const dna: any = (await storage.getBrandDnaForProject(userId, projectId).catch(() => null)) ?? (await storage.getBrandDna(userId));
    const site = typeof dna?.website === "string" ? dna.website.trim() : "";
    if (site && webScrapeConfigured()) {
      const page = await scrapeAsMarkdown(/^https?:\/\//i.test(site) ? site : `https://${site}`, 8000);
      if (page?.content) textes.push({ source: "site", texte: page.content });
      else echecs.push("site");
    }
  } catch { echecs.push("site"); }

  try {
    const posts = (await storage.getContent(userId, 60, projectId)) as any[];
    const publies = posts.filter((p) => p?.publishedAt || p?.postStatus === "posted").slice(0, 30);
    const corps = publies.map((p) => String(p.body || p.content || p.caption || "").slice(0, 800)).filter(Boolean);
    if (corps.length) textes.push({ source: "post", texte: corps.join("\n---\n") });
  } catch { echecs.push("post"); }

  try {
    const savoir = await db.select({ content: memoryEntries.content }).from(memoryEntries)
      .where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.projectId, projectId), eq(memoryEntries.fil, "savoir"), isNull(memoryEntries.supersededAt)))
      .orderBy(desc(memoryEntries.createdAt)).limit(40);
    if (savoir.length) textes.push({ source: "document", texte: savoir.map((s) => s.content).join("\n") });
  } catch { echecs.push("document"); }

  return { textes, echecs };
}

export class SourcesIndisponiblesError extends Error {
  constructor() { super("sources_indisponibles"); }
}

export async function suggererPreuves(userId: string, projectId: number): Promise<{ creees: number; sourcesEchouees: string[] }> {
  const { textes, echecs } = await lireSources(userId, projectId);
  if (textes.length === 0) {
    if (echecs.length > 0) throw new SourcesIndisponiblesError();
    return { creees: 0, sourcesEchouees: [] };
  }
  const existantes = await storage.getProjectProofs(userId, projectId);
  let creees = 0;
  for (const { source, texte } of textes) {
    const prompt = `Voici des textes publiés par l'utilisatrice (source : ${source}). Relève les RÉALISATIONS concrètes qui y sont EXPLICITEMENT décrites : pour qui (nom du client ou type de client), ce qui a été fait, le résultat s'il est écrit. N'invente rien, ne déduis rien : si une information n'est pas dans le texte, laisse-la vide. Ignore les intentions, les offres et les généralités.

TEXTES
${texte.slice(0, 12000)}

Réponds UNIQUEMENT avec ce JSON :
{"preuves":[{"clientLabel":"...","whatWasDone":"...","result":"...","tags":["secteur ou problème résolu"]}]}`;
    let raw = "";
    try {
      raw = await callClaudeWithContext({ userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1800, temperature: 0.2, destinataire: "tiers" });
    } catch { echecs.push(source); continue; }
    const nouvelles = dedoublonnerPropositions(existantes, parsePropositions(raw));
    for (const n of nouvelles) {
      const cree = await storage.createProjectProof({ userId, projectId, ...n, status: "proposed", source });
      existantes.push(cree);
      creees++;
    }
  }
  return { creees, sourcesEchouees: echecs };
}
