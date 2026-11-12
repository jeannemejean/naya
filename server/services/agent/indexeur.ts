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
import { suivrePassage } from "../fil/etat-taches-fond";
import { embedTextsParLots, lireEtatEmbeddings } from "../memory/embed";

export const TEXTE_MAX = 8000;
const SOURCES_INDEXEES = new Set(["tache_reponse", "livrable", "note", "conversation"]);
const INTERVALLE_MS = 2 * 60 * 1000;

// ── Lignes refusées par le service ────────────────────────────────────────────────────
// Le service rejette un lot entier dès qu'UN texte est refusé (embedTextsParLots rend alors
// null pour tout le lot). Sans précaution, une seule ligne « poison » bloquerait la file de
// toutes les utilisatrices à chaque passage. On distingue donc, avec la raison que journalise
// embed.ts, un refus de TEXTE (requête invalide : on reprend ligne à ligne et on met la
// fautive de côté) d'une panne GLOBALE (clé, quota, réseau, délai : on ne reprend rien,
// pour ne pas tirer 64 appels inutiles toutes les 2 min).
const RAISONS_REFUS_TEXTE = new Set([
  "invalid_request_error", "context_length_exceeded", "string_above_max_length", "http_400", "http_413", "http_422",
]);
const MIS_DE_COTE_MAX = 500;
// Clés `source:source_id:md5`, en mémoire du processus : un texte modifié (nouveau md5) est
// retenté ; un redémarrage retente tout une fois.
const misDeCote = new Set<string>();

const cle = (c: { source: string; source_id: number; md5: string }) => `${c.source}:${c.source_id}:${c.md5}`;

function mettreDeCote(c: Candidat): void {
  if (misDeCote.size >= MIS_DE_COTE_MAX) {
    const plusAncienne = misDeCote.values().next().value;
    if (plusAncienne !== undefined) misDeCote.delete(plusAncienne);
  }
  misDeCote.add(cle(c));
}

/** Test uniquement. */
export function _reinitialiserMisDeCote(): void {
  misDeCote.clear();
}

// L'échec qui vient de se produire (après `debut`) est-il un refus du texte lui-même ?
function refusDeTexte(debut: number): boolean {
  const echec = lireEtatEmbeddings().dernierEchec;
  return !!echec && echec.a.getTime() >= debut && RAISONS_REFUS_TEXTE.has(echec.raison);
}

// Lignes jamais indexées, ou dont le texte a changé depuis (md5 du texte indexé différent).
// Texte indexé : titre (tâche ou livrable), un saut de ligne, puis le contenu ; 8000 caractères.
// Ordre déterministe ; les lignes mises de côté sont exclues avant la limite, pour ne pas
// bloquer les suivantes.
export function requeteCandidats(limite: number, exclues: string[] = []): SQL {
  const exclusion = exclues.length
    ? sql`AND (s.source || ':' || s.source_id || ':' || md5(s.texte)) NOT IN (${sql.join(exclues.map((k) => sql`${k}`), sql`, `)})`
    : sql``;
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
    WHERE (r.id IS NULL OR r.contenu_md5 <> md5(s.texte))
      ${exclusion}
    ORDER BY s.source, s.source_id
    LIMIT ${limite}
  `;
}

interface Candidat { source: string; source_id: number; user_id: string; texte: string; md5: string }

export async function indexerUnLot(limite = 64): Promise<{ indexes: number; echecs: number }> {
  const res: any = await db.execute(requeteCandidats(limite, Array.from(misDeCote)));
  // Garde-fou : seule une des quatre sources indexées peut partir au service d'embeddings.
  const candidats = ((res.rows ?? res) as Candidat[]).filter((c) => SOURCES_INDEXEES.has(c.source));
  if (candidats.length === 0) return { indexes: 0, echecs: 0 };

  const debut = Date.now();
  const vecteurs = await embedTextsParLots(candidats.map((c) => c.texte), { taille: limite });
  if (!vecteurs.some((v) => v !== null) && refusDeTexte(debut)) {
    if (candidats.length === 1) {
      mettreDeCote(candidats[0]);
    } else {
      // Reprise ligne à ligne, au plus une fois par passage ; arrêtée net si la panne devient globale.
      for (let i = 0; i < candidats.length; i += 1) {
        const t0 = Date.now();
        const [v] = await embedTextsParLots([candidats[i].texte], { taille: 1 });
        if (v) { vecteurs[i] = v; continue; }
        if (!refusDeTexte(t0)) break;
        mettreDeCote(candidats[i]);
        console.warn(`[Indexeur] ${candidats[i].source} ${candidats[i].source_id} refusé par le service : mis de côté`);
      }
    }
  }
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
    const { indexes, echecs } = await suivrePassage("indexeur", () => indexerUnLot());
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
