import { db } from "../../db";
import { sql } from "drizzle-orm";
import { businessMemory, memoryEntries } from "@shared/schema";
import { eq } from "drizzle-orm";
import { embedText } from "./embed";
import type { Fil } from "./retrieve";

// Migration douce de l'existant : chaque ligne `business_memory` → une entrée
// `memory_entries` (fil déduit du `type`, à défaut "cap"), embeddée.
// Best-effort + IDEMPOTENT : on saute une ligne déjà migrée (même userId + content).

const TYPE_TO_FIL: Record<string, Fil> = {
  // founder : façon de travailler / préférences de l'utilisateur
  preference: "founder", préférence: "founder", habit: "founder", habitude: "founder",
  founder: "founder", energy: "founder", énergie: "founder",
  // reception : audience / marché
  reception: "reception", réception: "reception", audience: "reception", market: "reception", marché: "reception",
  // cap : tout le reste (identité / positionnement / offre / voix / stratégie)
};

function deduceFil(type: string): Fil {
  return TYPE_TO_FIL[(type || "").toLowerCase().trim()] ?? "cap";
}

export async function backfillBusinessMemory(): Promise<{ migrated: number; skipped: number; failed: number }> {
  let migrated = 0, skipped = 0, failed = 0;
  const rows = await db.select().from(businessMemory).where(eq(businessMemory.archived, false));

  for (const r of rows) {
    try {
      // Idempotence : déjà migré (même user + même contenu) ?
      const exists: any = await db.execute(sql`
        SELECT 1 FROM memory_entries WHERE user_id = ${r.userId} AND content = ${r.content} LIMIT 1
      `);
      if ((exists.rows ?? exists).length > 0) { skipped++; continue; }

      const embedding = await embedText(r.content); // best-effort
      if (!embedding) { failed++; continue; }        // pas d'embedding → on saute (réessayable)

      await db.insert(memoryEntries).values({
        userId: r.userId,
        projectId: null,                 // business_memory n'a pas de projectId → transverse
        fil: deduceFil(r.type),
        entryType: "fait",
        content: r.content,
        embedding,
        salience: 0.5,                   // valeur de départ (pas d'importance historique)
        sourceCaptureId: r.sourceEntryId ?? null,
      });
      migrated++;
    } catch {
      failed++; // best-effort : on continue
    }
  }
  return { migrated, skipped, failed };
}
