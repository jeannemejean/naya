// Ranger un souvenir à la demande de l'utilisatrice (outil `ranger_information` de l'agent).
// Insertion directe dans `memory_entries`, sans passer par l'extraction ni l'arbitre de doublons :
// ce qu'elle demande de retenir est retenu tel quel. Pas de suppression : un souvenir annulé
// est PÉRIMÉ (`superseded_at`), comme partout dans la mémoire (bi-temporel).
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { embedText } from "./embed";

export type FilRange = "cap" | "founder" | "savoir";

// Posé délibérément par l'utilisatrice : plus lourd qu'une observation déduite (0.5),
// un peu moins qu'un dossier de recherche déposé (0.8).
export const SALIENCE_SOUVENIR = 0.6;

export async function rangerSouvenir(
  userId: string,
  projectId: number | null,
  contenu: string,
  fil: FilRange,
  entryType: string,
): Promise<{ id: number }> {
  // Embedding best-effort : sans vecteur la ligne reste écrite, retrouvable par fraîcheur.
  const embedding = await embedText(contenu).catch(() => null);
  const [row] = await db.insert(memoryEntries).values({
    userId,
    projectId,
    fil,
    entryType,
    content: contenu,
    // Le tableau brut (la colonne `vector` de Drizzle attend number[]), comme extract.ts.
    embedding: embedding ?? null,
    salience: SALIENCE_SOUVENIR,
  } as any).returning({ id: memoryEntries.id });
  return { id: row.id };
}

// Lecture bornée à userId (annulation) : undefined si la ligne n'est pas à cette utilisatrice.
export async function lireSouvenir(
  userId: string,
  id: number,
): Promise<{ id: number; content: string; fil: string; entryType: string; supersededAt: Date | null } | undefined> {
  const res: any = await db.execute(sql`
    SELECT id, content, fil, entry_type AS "entryType", superseded_at AS "supersededAt"
    FROM memory_entries WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `);
  const r = (res.rows ?? res)[0];
  return r ? { id: Number(r.id), content: r.content, fil: r.fil, entryType: r.entryType, supersededAt: r.supersededAt ?? null } : undefined;
}

// Annulation : le souvenir cesse de ressortir, il n'est pas effacé.
export async function perimerSouvenir(userId: string, id: number): Promise<void> {
  await db.execute(sql`
    UPDATE memory_entries SET superseded_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND superseded_at IS NULL
  `);
}
