// Après la suppression de posts (outil `supprimer_posts` de l'agent, 17 nov. 2026) : l'atelier de
// chaque semaine touchée suit. S'il reste des posts, le placement habituel redimensionne l'atelier
// (les parties en trop sont archivées) ; s'il n'en reste aucun, l'atelier et la validation non
// faits de la semaine sont archivés. Archiver, jamais supprimer (règle de atelier/placement.ts).
import { etatPost, lundiDe, plusJours } from "@shared/atelier";
import { jourDuPost, postAProduire } from "../campagne/production";

export interface ReajusterDeps {
  postsEntre(userId: string, debut: Date, fin: Date): Promise<any[]>;
  tachesAtelier(userId: string, lundi: string): Promise<any[]>;
  archiverTaches(userId: string, ids: number[]): Promise<void>;
  placer(userId: string, posts: any[]): Promise<unknown>;
}

/** Le lundi de la semaine d'un post programmé, ou null sans date. */
export function lundiDuPost(scheduledFor: Date | string | null | undefined): string | null {
  return scheduledFor ? lundiDe(jourDuPost(scheduledFor)) : null;
}

export async function reajusterAteliers(
  deps: ReajusterDeps, userId: string, lundis: string[], aujourdhui: string,
): Promise<void> {
  for (const lundi of Array.from(new Set(lundis))) {
    // Un jour de marge de chaque côté : les bornes sont en UTC, la semaine en heure de Paris ;
    // le filtre par lundiDuPost garde exactement la semaine.
    const debut = new Date(`${plusJours(lundi, -1)}T00:00:00.000Z`);
    const fin = new Date(`${plusJours(lundi, 8)}T00:00:00.000Z`);
    const restants = (await deps.postsEntre(userId, debut, fin))
      .filter((p) => lundiDuPost(p.scheduledFor) === lundi && postAProduire(p, aujourdhui))
      // Seuls les posts encore à écrire font vivre un atelier (même règle que atelier/placement.ts) :
      // un post déjà validé n'a plus besoin de séance.
      .filter((p) => ["a_rediger", "brouillon"].includes(etatPost(p)));
    if (restants.length > 0) {
      await deps.placer(userId, restants);
      continue;
    }
    const nonFaites = (await deps.tachesAtelier(userId, lundi)).filter((t) => !t.completed).map((t) => t.id);
    if (nonFaites.length) await deps.archiverTaches(userId, nonFaites);
  }
}
