// Les préférences d'une marque atteignent la génération de campagne.
//
// Tâche 1 écrit une préférence en mémoire quand une campagne est rejetée. Tâche 2
// l'exécute en base. Sans CE module, cette écriture ne servirait à rien :
// `generateCampaignStrategy` et `generateCampaignContent` (`server/services/openai.ts`)
// appellent le modèle EN DIRECT (`callClaudeDetailed`), pas via `callClaudeWithContext` —
// elles ne lisent donc AUCUNE mémoire de marque par elles-mêmes. C'est ce module qui va
// chercher les préférences et les met à la disposition de l'appelant, pour qu'il les
// injecte au prompt.
//
// Brancher la génération sur `buildNayaContext` (qui lit la mémoire pour d'autres
// usages) est une autre voie, explicitement écartée par le spec de ce chantier.

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { db } from "../../db";

/** Nombre maximal de préférences injectées dans un prompt de génération. */
export const PLAFOND_PREFERENCES = 8;

export interface Preference {
  id: number;
  content: string;
  salience: number | null;
  createdAt: Date | null;
}

/**
 * Les préférences actives de cette marque, pour injection dans un prompt de
 * génération de campagne.
 *
 * La requête porte sur les QUATRE conditions à la fois : `userId`, `projectId`,
 * `fil = "cap"`, `entryType = "préférence"`, ET `supersededAt IS NULL`. Une préférence
 * périmée ne doit jamais atteindre le prompt — c'est tout l'intérêt du `supersededAt`
 * de cette table, qui dit « périmé = invalidé, pas supprimé », pas « périmé = absent
 * de la requête si on oublie le filtre ».
 *
 * Le tri est PORTEUR DE GARANTIE, pas décoratif : sans `ORDER BY` explicite, quelles
 * préférences atteignent le prompt dépendrait de l'ordre physique de Postgres, et deux
 * générations identiques ne recevraient pas les mêmes préférences. `salience DESC`
 * fait remonter les plus importantes ; `createdAt DESC` rend le départage déterministe
 * à salience égale (deux préférences à 0.8 ne se classeraient pas au hasard).
 *
 * Le plafond est appliqué EN SQL (`LIMIT`), pas en mémoire après coup — mais une
 * requête avec `LIMIT` ne dit jamais combien de lignes elle a laissées de côté. Quand
 * le nombre de lignes rendues atteint exactement le plafond, une seconde requête
 * (`COUNT(*)`, sans `LIMIT`, sur la même clause) vérifie s'il y en avait réellement
 * plus, pour journaliser le compte RÉEL écarté — jamais une approximation — sans payer
 * le coût de ce second aller-retour quand il ne sert à rien.
 */
export async function preferencesDeLaMarque(userId: string, projectId: number): Promise<Preference[]> {
  const clause = and(
    eq(memoryEntries.userId, userId),
    eq(memoryEntries.projectId, projectId),
    eq(memoryEntries.fil, "cap"),
    eq(memoryEntries.entryType, "préférence"),
    isNull(memoryEntries.supersededAt),
  );

  const lignes = await db
    .select({
      id: memoryEntries.id,
      content: memoryEntries.content,
      salience: memoryEntries.salience,
      createdAt: memoryEntries.createdAt,
    })
    .from(memoryEntries)
    .where(clause)
    .orderBy(desc(memoryEntries.salience), desc(memoryEntries.createdAt))
    .limit(PLAFOND_PREFERENCES);

  if (lignes.length === PLAFOND_PREFERENCES) {
    const [ligneCompte] = await db.select({ total: count() }).from(memoryEntries).where(clause);
    const total = ligneCompte?.total ?? lignes.length;
    if (total > PLAFOND_PREFERENCES) {
      console.info(
        `[Rejet] préférences de la marque ${projectId} : ${total - PLAFOND_PREFERENCES} ` +
          `préférence(s) écartée(s) au-delà du plafond de ${PLAFOND_PREFERENCES}.`,
      );
    }
  }

  return lignes;
}

/**
 * Le bloc injecté dans le prompt de génération. Volontairement PAUVRE : il n'expose
 * QUE `content`, par accès nommé — jamais d'étalement (`...p`), jamais de
 * `JSON.stringify`. C'est ce qui rend structurellement impossible la fuite d'un champ
 * qu'on n'a pas voulu envoyer : ni identifiant, ni salience, ni date de création ne
 * peuvent se retrouver dans la sortie, même si `Preference` gagnait un champ demain.
 *
 * Rend une chaîne vide sans préférences, pour que l'appelant n'injecte alors rien
 * (motif `articulation` : `request.preferences?.length ? ... : ''`).
 */
export function formaterPreferences(ps: Preference[]): string {
  if (ps.length === 0) return "";
  const lignes: string[] = [
    "PRÉFÉRENCES EXPRIMÉES PAR L'UTILISATRICE SUR CETTE MARQUE",
    ...ps.map((p) => `- ${p.content}`),
  ];
  return lignes.join("\n");
}
