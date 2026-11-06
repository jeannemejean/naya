// Accès en base de l'agent omniscient. Isolé dans un objet `depot` pour être mockable dans
// les tests : aucune requête ici n'échappe au filtre sur user_id.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import {
  agentActions,
  agentPropositions,
  type AgentAction,
  type AgentProposition,
} from "@shared/schema";
import type { Changement } from "@shared/agent";

// Une ligne touchée par une action directe : de quoi la remettre en l'état (annulation).
export interface LigneJournal {
  table: "tasks" | "quick_capture_entries" | "task_lists" | "memory_entries" | "user_preferences";
  id: number | string;
  avant: Record<string, unknown> | null; // null = créée par l'action
  apres: Record<string, unknown>;
}

export type MajProposition = Partial<Pick<AgentProposition, "statut" | "resultat">>;

export const depot = {
  async ajouterAction(userId: string, outil: string, resume: string, lignes: LigneJournal[]): Promise<AgentAction> {
    const [a] = await db.insert(agentActions).values({ userId, outil, resume, lignes }).returning();
    return a;
  },

  async getAction(id: number, userId: string): Promise<AgentAction | undefined> {
    const [a] = await db.select().from(agentActions)
      .where(and(eq(agentActions.id, id), eq(agentActions.userId, userId)))
      .limit(1);
    return a;
  },

  async marquerAnnulee(id: number, userId: string, quand: Date): Promise<void> {
    await db.update(agentActions).set({ annuleeAt: quand })
      .where(and(eq(agentActions.id, id), eq(agentActions.userId, userId)));
  },

  // Parmi ces actions, celles que l'utilisatrice a annulées (une seule requête, bornée à elle).
  async actionsAnnulees(userId: string, ids: number[]): Promise<{ id: number; resume: string }[]> {
    if (ids.length === 0) return [];
    return db.select({ id: agentActions.id, resume: agentActions.resume }).from(agentActions)
      .where(and(eq(agentActions.userId, userId), inArray(agentActions.id, ids), isNotNull(agentActions.annuleeAt)));
  },

  async ajouterProposition(
    userId: string,
    outil: string,
    args: unknown,
    changements: Changement[],
    empreinte: unknown,
    expireA: Date,
  ): Promise<AgentProposition> {
    const [p] = await db.insert(agentPropositions).values({
      userId, outil, arguments: args, changements, empreinte, statut: "en_attente", expireA,
    }).returning();
    return p;
  },

  async getProposition(id: number, userId: string): Promise<AgentProposition | undefined> {
    const [p] = await db.select().from(agentPropositions)
      .where(and(eq(agentPropositions.id, id), eq(agentPropositions.userId, userId)))
      .limit(1);
    return p;
  },

  async majProposition(id: number, userId: string, patch: MajProposition): Promise<AgentProposition | undefined> {
    const [p] = await db.update(agentPropositions).set(patch)
      .where(and(eq(agentPropositions.id, id), eq(agentPropositions.userId, userId)))
      .returning();
    return p;
  },

  // Fait sortir une proposition de l'attente, ATOMIQUEMENT : la mise à jour ne touche la ligne
  // que si elle est encore `en_attente`. Deux clics simultanés sur « Valider » : un seul
  // obtient `true` et exécute, l'autre `false` (déjà traitée). Jamais deux exécutions.
  async reclamerProposition(
    id: number,
    userId: string,
    statut: "validee" | "annulee" | "expiree",
  ): Promise<boolean> {
    const lignes = await db.update(agentPropositions).set({ statut })
      .where(and(
        eq(agentPropositions.id, id),
        eq(agentPropositions.userId, userId),
        eq(agentPropositions.statut, "en_attente"),
      ))
      .returning({ id: agentPropositions.id });
    return lignes.length > 0;
  },
};
