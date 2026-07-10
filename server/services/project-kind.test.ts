import { describe, it, expect } from "vitest";
import { insertProjectSchema } from "@shared/schema";
import { evaluateProjectOvercommit } from "./overcommit";
import { allocateTaskCaps } from "./task-allocation";
import { pickAllowedProjectFields } from "./project-fields";

// Séparation projets personnels / clients. `project_kind` est un axe ADDITIF : il n'est
// ni requis (DEFAULT 'personal') ni bloquant (aucune feature existante ne le lit).

describe("project_kind — nouveau champ (insertProjectSchema)", () => {
  it("un projet sans project_kind est valide (la base applique DEFAULT 'personal')", () => {
    const parsed = insertProjectSchema.parse({ userId: "u1", name: "Naya" });
    expect(parsed.name).toBe("Naya");
    // Non fourni → optionnel côté schéma (le DEFAULT SQL s'applique à l'insert).
    expect(parsed.projectKind).toBeUndefined();
  });

  it("accepte un projet client avec métadonnées", () => {
    const parsed = insertProjectSchema.parse({
      userId: "u1",
      name: "Refonte Acme",
      projectKind: "client",
      clientName: "Acme SARL",
      clientContact: "jean@acme.fr",
      clientBrief: "Refonte + campagne Q1",
    });
    expect(parsed.projectKind).toBe("client");
    expect(parsed.clientName).toBe("Acme SARL");
  });

  it("rejette une valeur project_kind invalide (enum strict)", () => {
    expect(() => insertProjectSchema.parse({ userId: "u1", name: "X", projectKind: "agency" })).toThrow();
  });

  it("les champs client sont optionnels/nullable (projet perso sans eux)", () => {
    const parsed = insertProjectSchema.parse({ userId: "u1", name: "X", projectKind: "personal", clientName: null });
    expect(parsed.projectKind).toBe("personal");
    expect(parsed.clientName).toBeNull();
  });

  it("compat StatusNote : un projet des DEUX kinds peut porter statusNote (injecté ensuite dans buildNayaContext)", () => {
    const perso = insertProjectSchema.parse({ userId: "u1", name: "Naya", statusNote: "lancement repoussé" });
    const client = insertProjectSchema.parse({ userId: "u1", name: "Acme", projectKind: "client", clientName: "Acme", statusNote: "brief validé hors app" });
    expect(perso.statusNote).toBe("lancement repoussé");
    expect(client.statusNote).toBe("brief validé hors app");
  });
});

describe("project_kind — whitelist PATCH persiste les métadonnées client", () => {
  it("PATCH d'un projet client persiste kind + client_name/contact/brief", () => {
    const out = pickAllowedProjectFields({
      projectKind: "client",
      clientName: "Test Client",
      clientContact: "contact@test.fr",
      clientBrief: "brief",
    });
    expect(out).toEqual({
      projectKind: "client",
      clientName: "Test Client",
      clientContact: "contact@test.fr",
      clientBrief: "brief",
    });
  });
});

describe("compat overcommit — indépendant de project_kind", () => {
  it("le statut de surcharge ne dépend QUE de (nb tâches, budget, durées) — pas du kind", () => {
    // Deux projets identiques en budget/tâches, un client, un perso → même signature d'entrée,
    // donc forcément même résultat (evaluateProjectOvercommit ne reçoit jamais le kind).
    const persoStatus = evaluateProjectOvercommit(9, 4, [30, 30, 30]);
    const clientStatus = evaluateProjectOvercommit(9, 4, [30, 30, 30]);
    expect(clientStatus).toEqual(persoStatus);
    // Le calcul reste piloté par budget (revenu/passion via category), jamais par project_kind.
    expect(persoStatus.dailyTimeBudgetHours).toBe(4);
  });
});

describe("compat génération quotidienne (task-allocation) — indépendant de project_kind", () => {
  it("allocateTaskCaps ne lit que dailyTimeBudgetHours : ajouter project_kind ne change rien", () => {
    const withoutKind = allocateTaskCaps([{ dailyTimeBudgetHours: 4 }, { dailyTimeBudgetHours: 1 }], 20);
    const withKind = allocateTaskCaps(
      [
        { dailyTimeBudgetHours: 4, projectKind: "client", clientName: "Acme" } as any,
        { dailyTimeBudgetHours: 1, projectKind: "personal" } as any,
      ],
      20,
    );
    expect(withKind).toEqual(withoutKind);
    // Le projet avec plus de budget reçoit un cap ≥ à celui avec moins de budget.
    expect(withKind[0]).toBeGreaterThanOrEqual(withKind[1]);
  });
});
