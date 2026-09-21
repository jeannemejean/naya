import { db } from "../../db";
import { sql } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { embedTexts } from "./embed";
import { decouperDocument } from "./decoupe-document";

/**
 * Dépôt d'un dossier de recherche dans la mémoire de Naya.
 *
 * Demande de Jeanne (18 septembre 2026) : pouvoir envoyer à Naya des dossiers sur ce qui
 * fonctionne en digital, et sur ce à quoi ressemble une bonne prospection, pour qu'elle soit
 * « plus pointue, moins générique ».
 *
 * Aucune table nouvelle : `memory_entries` porte déjà le contenu, l'embedding, la salience et
 * le bi-temporel. Le dossier rejoint le fil `savoir`, que `buildNayaContext` injecte dans
 * chaque appel IA — donc la création de contenu ET la prospection s'en servent sans qu'on ait
 * à les brancher séparément.
 *
 * L'embedding est BEST-EFFORT. Un morceau sans vecteur reste écrit et reste retrouvable :
 * le scoring du module est additif, pas multiplicatif, précisément pour ne pas s'effondrer
 * quand un facteur manque. Perdre le travail de quelqu'un parce qu'un appel d'embedding a
 * raté serait le défaut que tout ce dépôt corrige.
 */

export interface ResultatDepot {
  morceaux: number;
  vectorises: number;
}

export async function deposerDossier(input: {
  userId: string;
  projectId: number | null;
  titre: string;
  contenu: string;
}): Promise<ResultatDepot> {
  const morceaux = decouperDocument(input.contenu);
  if (morceaux.length === 0) return { morceaux: 0, vectorises: 0 };

  const titre = input.titre.trim() || "Dossier sans titre";

  // Le titre préfixe chaque morceau : isolé, un morceau du milieu d'un dossier ne dit pas
  // de quoi il parle, et son embedding non plus.
  const textes = morceaux.map((m) => `${titre} — ${m}`);

  // Best-effort, en un seul appel : `null` si le service est indisponible.
  const vecteurs = await embedTexts(textes).catch(() => null);

  let vectorises = 0;
  for (let i = 0; i < morceaux.length; i += 1) {
    const vecteur = vecteurs?.[i] ?? null;
    try {
      await db.insert(memoryEntries).values({
        userId: input.userId,
        projectId: input.projectId,
        fil: "savoir",
        entryType: "fait",
        content: textes[i],
        // Le TABLEAU brut, pas un litteral texte : la colonne `vector` de Drizzle attend
        // number[]. `toVectorLiteral` ne sert qu'aux requetes SQL de recherche — c'est ce
        // que fait extract.ts, et s'en ecarter aurait ecrit une chaine dans un vecteur.
        embedding: vecteur ?? null,
        // Salience haute : un dossier est déposé DÉLIBÉRÉMENT, contrairement à une
        // observation que Naya déduit. Ce que Jeanne prend la peine d'apporter pèse plus
        // lourd que ce que Naya devine.
        salience: 0.8,
      } as any);
      if (vecteur) vectorises += 1;
    } catch (e: any) {
      // Un morceau qui échoue ne doit pas emporter les autres : un dossier à moitié déposé
      // vaut mieux qu'un dossier perdu.
      console.error(`[Savoir] morceau ${i + 1}/${morceaux.length} non écrit:`, e?.message ?? e);
    }
  }

  return { morceaux: morceaux.length, vectorises };
}

/**
 * Les dossiers déposés, regroupés par titre — pour relire ce que Naya a appris.
 *
 * Un dossier déposé est découpé en morceaux ; les lister un par un serait illisible. On les
 * regroupe donc par titre, avec le nombre de morceaux et la date de dépôt.
 *
 * Les morceaux invalidés (`superseded_at`) sont exclus : la mémoire est bi-temporelle —
 * périmé veut dire invalidé, jamais supprimé.
 */
export async function listerDossiers(userId: string): Promise<
  { titre: string; morceaux: number; vectorises: number; depose_le: Date }[]
> {
  const r = await db.execute(sql`
    SELECT
      split_part(content, ' — ', 1) AS titre,
      count(*)::int                 AS morceaux,
      count(embedding)::int         AS vectorises,
      min(created_at)               AS depose_le
    FROM memory_entries
    WHERE user_id = ${userId}
      AND fil = 'savoir'
      AND superseded_at IS NULL
    GROUP BY 1
    ORDER BY min(created_at) DESC
  `);
  return (r.rows ?? []) as any[];
}
