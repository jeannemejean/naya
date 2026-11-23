// Garde de publication de la validation client (lot 8). Un post « à valider » ou « refusé »
// d'une marque dont la validation est active ne part JAMAIS seul : le worker ne le lit pas
// (getDueScheduledContent) et ne peut pas le réclamer (claimContentForPosting). À son heure,
// il attend encore 3 h (comme Metricool) ; au-delà, il passe en échec (« validation_manquante »
// ou « validation_refusee ») avec la tâche d'alerte habituelle.
import { and, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { content } from "@shared/schema";
import { decisionPublication, GRACE_VALIDATION_MIN } from "@shared/validation-client";

/** Vrai pour une ligne de `content` bloquée par la validation client de sa marque. */
export const sqlBloqueParValidation: SQL = sql`(coalesce(${content.validationStatut}, '') in ('a_valider', 'refusee') and exists (select 1 from validation_projet vp where vp.project_id = ${content.projectId} and vp.actif = true))`;

/** Un post validé par le client pendant la grâce reste publiable jusqu'à 3 h après son heure. */
export function sqlValideDansLaGrace(maintenant: Date): SQL {
  return sql`(${content.validationStatut} = 'validee' and ${content.scheduledFor} >= ${new Date(maintenant.getTime() - GRACE_VALIDATION_MIN * 60_000)})`;
}

export interface PostEnAttente { id: number; userId: string; title: string | null; platform: string | null; scheduledFor: Date | null; validationStatut: string | null }

export interface DepsAttenteValidation {
  /** Posts programmés, arrivés à leur heure (48 h au plus), bloqués par la validation. */
  enAttente(maintenant: Date): Promise<PostEnAttente[]>;
  /** Passe le post en échec s'il attend toujours. Rend false s'il a bougé entre-temps. */
  echouer(id: number, raison: string, maintenant: Date): Promise<boolean>;
  journaliser(userId: string, contentId: number, evenement: "echec", details: Record<string, unknown>): Promise<void>;
  signalerEchec(item: { id: number; userId: string; title?: string | null; platform?: string | null }, raison: string): Promise<void>;
}

export const depsAttenteDb: Pick<DepsAttenteValidation, "enAttente" | "echouer"> = {
  enAttente: (maintenant) => db.select({
    id: content.id, userId: content.userId, title: content.title, platform: content.platform,
    scheduledFor: content.scheduledFor, validationStatut: content.validationStatut,
  }).from(content).where(and(
    eq(content.autoPost, true), eq(content.postStatus, "pending"), isNull(content.publishedAt), isNull(content.supprimeLe),
    lte(content.scheduledFor, maintenant), gte(content.scheduledFor, new Date(maintenant.getTime() - 48 * 3_600_000)),
    sqlBloqueParValidation,
  )).limit(100),
  async echouer(id, raison, maintenant) {
    const r = await db.update(content).set({ postStatus: "failed", lastError: raison, updatedAt: maintenant } as any)
      .where(and(eq(content.id, id), eq(content.postStatus, "pending"), sqlBloqueParValidation))
      .returning({ id: content.id });
    return r.length > 0;
  },
};

/** Un passage : les posts dont la grâce est écoulée partent en échec, avec alerte. */
export async function traiterAttentesValidation(maintenant: Date, deps: DepsAttenteValidation): Promise<{ attente: number; echecs: number }> {
  const posts = await deps.enAttente(maintenant);
  let attente = 0, echecs = 0;
  for (const p of posts) {
    const d = decisionPublication({ validationActive: true, statut: p.validationStatut, scheduledFor: p.scheduledFor, maintenant });
    if (d.action === "attendre") { attente++; continue; }
    if (d.action !== "echec") continue;
    if (!(await deps.echouer(p.id, d.raison, maintenant))) continue;
    echecs++;
    await deps.journaliser(p.userId, p.id, "echec", { raison: d.raison });
    await deps.signalerEchec(p, d.raison);
  }
  return { attente, echecs };
}
