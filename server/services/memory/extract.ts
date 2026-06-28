import { db } from "../../db";
import { sql } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { callClaude, CLAUDE_MODELS } from "../claude";
import { embedText, toVectorLiteral } from "./embed";
import { resolveEntryProjectId } from "./brand-resolve";
import type { Fil } from "./retrieve";

// ════════════════════════════════════════════════════════════════════════════════
// PROMPT D'EXTRACTION — copié À L'IDENTIQUE depuis DECISIONS-MEMOIRE-IA.md §7.
// Ne pas reformuler : c'est une décision figée, fondée sur l'état de l'art.
// ════════════════════════════════════════════════════════════════════════════════
export const EXTRACTION_PROMPT = `SYSTÈME — Extracteur de mémoire Naya

Tu es l'extracteur de mémoire de Naya. À partir d'une interaction (message de
l'utilisateur + réponse de Naya, ou une capture), tu extrais UNIQUEMENT les
informations durables qui méritent d'être mémorisées sur le business de
l'utilisateur. Tu ne réponds pas à l'utilisateur ; tu produis seulement du JSON.

Règles :
1. Extrais des FAITS ATOMIQUES — une seule information par entrée, autoportante,
   compréhensible hors contexte.
2. N'invente RIEN. Si l'interaction ne contient aucune information durable
   (bavardage, demande ponctuelle sans enseignement), renvoie [].
3. Ignore l'éphémère ("ok merci", "fais ça maintenant"). Ne garde que ce qui
   sera encore vrai dans une semaine.
4. Range chaque fait dans le bon FIL :
   - "cap"       : identité / positionnement / offre / voix / stratégie d'une
                   MARQUE. Ex : "La marque vise le haut de gamme", "Offre à 2000€",
                   "Ton : direct, jamais corporate".
   - "founder"   : façon de travailler de L'UTILISATEUR — préférences, habitudes,
                   rythme, énergie, contraintes de temps, manière de décider.
                   Ex : "Préfère traiter l'outbound l'après-midi", "Se décourage
                   quand trop de tâches le même jour", "Décide vite".
   - "reception" : observations sur l'AUDIENCE / le marché / la réception.
                   Ex : "L'audience réagit mieux aux carrousels qu'aux reels".
5. Type chaque entrée : "fait" | "décision" | "préférence" | "observation".
6. Note l'IMPORTANCE de 0 à 10 : 0 = trivial, 10 = structurant pour le business.
   Décision stratégique ou contrainte forte = 8-10 ; préférence mineure = 3-5.

Sortie : un tableau JSON, et RIEN d'autre.
[{ "fil": "cap|founder|reception", "entryType": "...", "content": "...", "importance": 0-10 }]`;

export interface ExtractedEntry {
  fil: Fil;
  entryType: string;
  content: string;
  importance: number; // 0-10
}

// Entrée prête à passer dans le moteur de mise à jour (content déjà embeddé).
export interface MemoryCandidate {
  userId: string;
  projectId: number | null;
  fil: Fil;
  entryType: string;
  content: string;
  salience: number;       // importance / 10
  embedding: number[];
  sourceCaptureId?: number | null;
}

export type UpdateAction = "ADD" | "UPDATE" | "NOOP";

// ── Seuils du moteur de mise à jour (Décision 4 / Mem0) ─────────────────────────
const SIM_ADD = 0.85; // en dessous → clairement nouveau → ADD

// Repository injectable (DB réelle par défaut ; remplaçable en test).
export interface MemoryRepo {
  findNearest(userId: string, projectId: number | null, fil: Fil, embedding: number[]):
    Promise<{ id: number; content: string; similarity: number } | null>;
  insert(c: MemoryCandidate): Promise<number>;
  supersede(id: number): Promise<void>;
}

// Arbitre injectable : tranche NOOP / UPDATE / ADD pour des candidats sémantiquement proches.
export type Arbitrate = (args: {
  existing: { id: number; content: string; similarity: number };
  incoming: MemoryCandidate;
}) => Promise<UpdateAction>;

// ── Implémentation DB du repository ─────────────────────────────────────────────
export const dbRepo: MemoryRepo = {
  async findNearest(userId, projectId, fil, embedding) {
    const vec = toVectorLiteral(embedding);
    const scope = fil === "founder" ? sql`project_id IS NULL` : sql`project_id IS NOT DISTINCT FROM ${projectId}`;
    const res: any = await db.execute(sql`
      SELECT id, content, 1 - (embedding <=> ${vec}::vector) AS similarity
      FROM memory_entries
      WHERE user_id = ${userId} AND fil = ${fil} AND superseded_at IS NULL AND embedding IS NOT NULL AND ${scope}
      ORDER BY embedding <=> ${vec}::vector ASC
      LIMIT 1
    `);
    const row = (res.rows ?? res)[0];
    return row ? { id: Number(row.id), content: row.content, similarity: Number(row.similarity) } : null;
  },
  async insert(c) {
    const [row] = await db.insert(memoryEntries).values({
      userId: c.userId,
      projectId: c.projectId,
      fil: c.fil,
      entryType: c.entryType,
      content: c.content,
      embedding: c.embedding,
      salience: c.salience,
      sourceCaptureId: c.sourceCaptureId ?? null,
    }).returning({ id: memoryEntries.id });
    return row.id;
  },
  async supersede(id) {
    await db.execute(sql`UPDATE memory_entries SET superseded_at = now() WHERE id = ${id}`);
  },
};

// ── Arbitre par défaut : un appel `fast` (Haiku) via le routeur ─────────────────
// Best-effort : en cas d'échec, on choisit NOOP (conservateur — évite le bloat de doublons).
const defaultArbitrate: Arbitrate = async ({ existing, incoming }) => {
  try {
    const out = await callClaude({
      model: CLAUDE_MODELS.fast,
      taskKind: "extraction",
      max_tokens: 8,
      system:
        "Tu compares deux faits mémorisés sur un business. Réponds par UN SEUL mot :\n" +
        "- NOOP s'ils disent la MÊME chose (le nouveau n'apporte rien) ;\n" +
        "- UPDATE si le nouveau CONTREDIT ou MET À JOUR l'ancien (même sujet, valeur changée) ;\n" +
        "- ADD si le nouveau parle d'autre chose.\n" +
        "Réponds uniquement : NOOP, UPDATE ou ADD.",
      messages: [{ role: "user", content: `ANCIEN : ${existing.content}\nNOUVEAU : ${incoming.content}` }],
    });
    const w = (out || "").trim().toUpperCase();
    if (w.startsWith("UPDATE")) return "UPDATE";
    if (w.startsWith("ADD")) return "ADD";
    return "NOOP";
  } catch {
    return "NOOP";
  }
};

// ── Le moteur de mise à jour (Temps 2, Mem0) ────────────────────────────────────
// Pour une entrée déjà embeddée : cherche la plus proche dans (user, project, fil) ;
//   < SIM_ADD                → ADD ;
//   ≥ SIM_ADD                → l'arbitre tranche NOOP / UPDATE / ADD.
// (Note d'implémentation : on délègue TOUTE la bande ≥ 0.85 à l'arbitre — plutôt que
//  d'auto-NOOP à ≥ 0.92 — pour attraper les contradictions à haute similarité, le cas
//  UPDATE de la Décision 4. C'est une micro-décision d'implémentation, signalée ici.)
export async function runUpdateEngine(
  entry: MemoryCandidate,
  opts?: { repo?: MemoryRepo; arbitrate?: Arbitrate },
): Promise<UpdateAction> {
  const repo = opts?.repo ?? dbRepo;
  const arbitrate = opts?.arbitrate ?? defaultArbitrate;

  const nearest = await repo.findNearest(entry.userId, entry.projectId, entry.fil, entry.embedding);
  if (!nearest || nearest.similarity < SIM_ADD) {
    await repo.insert(entry);
    return "ADD";
  }
  const decision = await arbitrate({ existing: nearest, incoming: entry });
  if (decision === "NOOP") return "NOOP";
  if (decision === "UPDATE") {
    await repo.supersede(nearest.id);   // bi-temporel : on invalide, on ne supprime pas
    await repo.insert(entry);
    return "UPDATE";
  }
  await repo.insert(entry); // ADD
  return "ADD";
}

// ── Pipeline complet (Temps 1 + Temps 2), BEST-EFFORT / fire-and-forget ─────────
export async function extractToMemory(input: {
  userId: string;
  projectId?: number | null;        // projet ACTIF (UI) — pour audit uniquement, jamais pour taguer
  subjectProjectId?: number | null; // marque-SUJET résolue (named brand) — sert à taguer cap/reception
  sourceText: string;
  sourceType: "capture" | "companion" | "feedback";
  sourceCaptureId?: number | null;
}): Promise<void> {
  try {
    if (!input.sourceText || !input.sourceText.trim()) return;

    // Temps 1 — Extraction (modèle fast/Haiku, TaskKind "extraction", prompt figé).
    const raw = await callClaude({
      model: CLAUDE_MODELS.fast,
      taskKind: "extraction",
      system: EXTRACTION_PROMPT,
      max_tokens: 1024,
      userId: input.userId,
      projectId: input.projectId ?? null,
      messages: [{ role: "user", content: input.sourceText }],
    });

    const entries = parseEntries(raw);
    if (entries.length === 0) return; // rien de durable → aucune entrée fabriquée

    // Temps 2 — routage de marque + embed + moteur de mise à jour, entrée par entrée.
    for (const e of entries) {
      // Routage de marque (BRIEF-FIX-ROUTAGE-MARQUE) :
      //  - founder → transverse (null) ;
      //  - cap/reception → marque-SUJET résolue ; sans elle, on SAUTE (jamais le projet actif).
      const { projectId, skip } = resolveEntryProjectId(e.fil, input.subjectProjectId);
      if (skip) {
        // Audit best-effort : aucun fait d'ADN sous une marque non confirmée.
        console.info(`[brand-routing] SKIP ${e.fil} (aucune marque-sujet) src=${input.sourceType} active=${input.projectId ?? "null"} content="${e.content.slice(0, 60)}"`);
        continue;
      }
      const embedding = await embedText(e.content); // best-effort
      if (!embedding) continue; // pas d'embedding → on saute (dégradation silencieuse)
      await runUpdateEngine({
        userId: input.userId,
        projectId,
        fil: e.fil,
        entryType: e.entryType,
        content: e.content,
        salience: Math.max(0, Math.min(1, (e.importance ?? 5) / 10)), // Décision 3 : importance/10
        embedding,
        sourceCaptureId: input.sourceCaptureId ?? null,
      }).catch(() => {});
    }
  } catch {
    /* best-effort : ne JAMAIS bloquer une action utilisateur ni un appel IA */
  }
}

// Parse robuste de la sortie JSON de l'extracteur.
export function parseEntries(raw: string): ExtractedEntry[] {
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end < start) return [];
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    const VALID_FILS = new Set(["cap", "founder", "reception"]);
    return arr
      .filter((e: any) => e && VALID_FILS.has(e.fil) && typeof e.content === "string" && e.content.trim())
      .map((e: any) => ({
        fil: e.fil as Fil,
        entryType: typeof e.entryType === "string" ? e.entryType : "fait",
        content: String(e.content).trim(),
        importance: Number.isFinite(e.importance) ? Number(e.importance) : 5,
      }));
  } catch {
    return [];
  }
}
