// Indexeur de la recherche par sens : tient `recherche_embeddings` à jour pour les quatre
// sources indexées (réponses de tâches, livrables texte, notes, ce que l'utilisatrice a dit à
// Naya). Tourne dans le processus, comme ProspectionSender : un lot toutes les 2 minutes,
// jamais deux passages en parallèle, erreurs journalisées, jamais levées.
//
// Les messages des prospects (inbox_messages) ne sont JAMAIS indexés ni envoyés au service
// d'embeddings : ce sont les mots de tiers, la recherche par mots suffit pour eux.
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { rechercheEmbeddings } from "@shared/schema";
import { embedTextsParLots } from "../memory/embed";

export const TEXTE_MAX = 8000;
const SOURCES_INDEXEES = new Set(["tache_reponse", "livrable", "note", "conversation"]);
const INTERVALLE_MS = 2 * 60 * 1000;

// Lignes jamais indexées, ou dont le texte a changé depuis (md5 du texte indexé différent).
// Texte indexé : titre (tâche ou livrable), un saut de ligne, puis le contenu ; 8000 caractères.
export function requeteCandidats(limite: number): SQL {
  return sql`
    SELECT s.source, s.source_id, s.user_id, s.texte, md5(s.texte) AS md5
    FROM (
      SELECT 'tache_reponse' AS source, e.id AS source_id, e.user_id,
             left(t.title || E'\\n' || e.content, ${TEXTE_MAX}) AS texte
      FROM task_workspace_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE char_length(e.content) >= 20
      UNION ALL
      SELECT 'livrable', l.id, l.user_id,
             left(coalesce(coalesce(l.task_title, l.file_name) || E'\\n', '') || l.content, ${TEXTE_MAX})
      FROM livrables l
      WHERE l.kind = 'texte' AND coalesce(l.content, '') <> ''
      UNION ALL
      SELECT 'note', q.id, q.user_id, left(q.content, ${TEXTE_MAX})
      FROM quick_capture_entries q
      WHERE q.content <> ''
      UNION ALL
      SELECT 'conversation', c.id, c.user_id, left(c.content, ${TEXTE_MAX})
      FROM companion_conversations c
      WHERE c.role = 'user' AND c.content <> ''
    ) s
    LEFT JOIN recherche_embeddings r ON r.source = s.source AND r.source_id = s.source_id
    WHERE r.id IS NULL OR r.contenu_md5 <> md5(s.texte)
    LIMIT ${limite}
  `;
}

interface Candidat { source: string; source_id: number; user_id: string; texte: string; md5: string }

export async function indexerUnLot(limite = 64): Promise<{ indexes: number; echecs: number }> {
  const res: any = await db.execute(requeteCandidats(limite));
  // Garde-fou : seule une des quatre sources indexées peut partir au service d'embeddings.
  const candidats = ((res.rows ?? res) as Candidat[]).filter((c) => SOURCES_INDEXEES.has(c.source));
  if (candidats.length === 0) return { indexes: 0, echecs: 0 };

  const vecteurs = await embedTextsParLots(candidats.map((c) => c.texte), { taille: limite });
  const valeurs = candidats.flatMap((c, i) => {
    const v = vecteurs[i];
    return v ? [{ userId: c.user_id, source: c.source, sourceId: Number(c.source_id), contenuMd5: c.md5, embedding: v, indexeAt: new Date() }] : [];
  });
  if (valeurs.length > 0) {
    await db.insert(rechercheEmbeddings).values(valeurs).onConflictDoUpdate({
      // source_id vient des séries globales de chaque table (pas d'une numérotation par
      // utilisatrice) : (source, source_id) est donc unique sans user_id.
      target: [rechercheEmbeddings.source, rechercheEmbeddings.sourceId],
      set: {
        userId: sql`excluded.user_id`,
        contenuMd5: sql`excluded.contenu_md5`,
        embedding: sql`excluded.embedding`,
        indexeAt: sql`excluded.indexe_at`,
      },
    });
  }
  return { indexes: valeurs.length, echecs: candidats.length - valeurs.length };
}

let enCours = false;

// Un passage : un lot, sauf si le précédent tourne encore. Ne lève jamais.
export async function passerIndexeur(): Promise<void> {
  if (enCours) return;
  enCours = true;
  try {
    const { indexes, echecs } = await indexerUnLot();
    if (indexes || echecs) console.log(`[Indexeur] ${indexes} indexé(s), ${echecs} échec(s)`);
  } catch (e: any) {
    console.error("[Indexeur]", e?.message ?? e);
  } finally {
    enCours = false;
  }
}

export function demarrerIndexeur(): void {
  console.log("[Indexeur] Worker démarré (toutes les 2 min)");
  setInterval(() => { void passerIndexeur(); }, INTERVALLE_MS);
}
