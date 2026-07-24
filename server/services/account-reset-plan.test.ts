import { describe, it, expect } from "vitest";
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { ACCOUNT_RESET_PLAN, findUnsafeReferences, type ResetStep } from "./account-reset-plan";

/** Toutes les tables Postgres déclarées dans le schéma. */
const allTables = Object.values(schema).filter((value): value is PgTable => is(value, PgTable));

describe("plan de reset de compte", () => {
  it("le schéma expose bien des tables (garde-fou du test lui-même)", () => {
    expect(allTables.length).toBeGreaterThan(20);
  });

  it("ne laisse AUCUNE référence FK non couverte", () => {
    const unsafe = findUnsafeReferences(allTables, ACCOUNT_RESET_PLAN);

    // Message lisible : c'est ce qui casse le reset en prod (« Échec de la sauvegarde des paramètres »).
    const details = unsafe.map((u) => `${u.child}.${u.column} → ${u.parent} : ${u.reason}`).join("\n");
    expect(details).toBe("");
    expect(unsafe).toEqual([]);
  });

  it("détecte une table enfant oubliée", () => {
    const planSansLeadStepMessages = ACCOUNT_RESET_PLAN.filter((s) => s.table !== "lead_step_messages");
    const unsafe = findUnsafeReferences(allTables, planSansLeadStepMessages);

    expect(unsafe).toContainEqual(
      expect.objectContaining({ child: "lead_step_messages", parent: "leads" }),
    );
  });

  it("détecte un enfant supprimé APRÈS son parent", () => {
    const planInverse: ResetStep[] = [
      { table: "leads", mode: "delete" },
      { table: "outreach_messages", mode: "delete" },
    ];
    const unsafe = findUnsafeReferences(allTables, planInverse);

    expect(unsafe).toContainEqual(
      expect.objectContaining({ child: "outreach_messages", column: "lead_id", parent: "leads" }),
    );
  });

  it("considère comme sûre une FK détachée avant la suppression du parent", () => {
    const plan: ResetStep[] = [
      { table: "prospection_usage", mode: "detach", columns: ["prospect_id", "campaign_id"] },
      { table: "lead_step_messages", mode: "delete" },
      { table: "lead_sequence_state", mode: "delete" },
      { table: "outreach_messages", mode: "delete" },
      { table: "leads", mode: "delete" },
    ];
    const unsafe = findUnsafeReferences(allTables, plan);

    expect(unsafe.filter((u) => u.child === "prospection_usage")).toEqual([]);
  });

  it("ignore les FK gérées par Postgres (cascade / set null)", () => {
    // task_dependencies → tasks est en ON DELETE CASCADE, jamais listée dans le plan.
    const unsafe = findUnsafeReferences(allTables, ACCOUNT_RESET_PLAN);
    expect(unsafe.filter((u) => u.child === "task_dependencies")).toEqual([]);
  });
});
