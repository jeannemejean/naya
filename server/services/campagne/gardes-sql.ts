// Conditions SQL de garde partagées par « repenser » (repenser-db.ts) et
// `storage.deleteCampaignContentItems` (/regenerate-content). Module sans dépendance vers
// `storage` : l'importer depuis storage.ts ne crée pas de cycle.
import { and, isNull, sql, type SQL } from "drizzle-orm";
import { content, tasks } from "@shared/schema";

/**
 * Les conditions de garde, REDITES dans le DELETE : entre la lecture et la suppression, le
 * publieur (`claimContentForPosting` → `posting`) peut prendre un post, ou une tâche être
 * cochée. Mêmes signaux que `contenuEstPublie` + `estPublieOuEnCours`, insensibles à la
 * casse et aux espaces comme eux, et sûrs face à NULL.
 */
export const STATUTS_POST_GARDES = ["posted", "uploading", "processing", "posting"] as const;

export function contenuSupprimable(): SQL {
  return and(
    isNull(content.publishedAt),
    sql`lower(trim(coalesce(${content.postStatus}, ''))) not in (${sql.join(STATUTS_POST_GARDES.map((v) => sql`${v}`), sql`, `)})`,
    sql`lower(trim(coalesce(${content.contentStatus}, ''))) <> 'published'`,
  )!;
}

export function tacheSupprimable(): SQL {
  return sql`${tasks.completed} is not true`;
}
