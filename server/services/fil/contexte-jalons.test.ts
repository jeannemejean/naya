import { describe, it, expect, vi } from "vitest";

vi.mock("../../storage", () => ({ storage: {} }));
import { formaterJalonsDuProjet } from "./contexte-jalons";

const j = (id: number, title: string, status: string, goalId: number | null, order = 0, pourquoi: string | null = null) =>
  ({ id, title, status, goalId, projectId: 7, order, pourquoi });

describe("formaterJalonsDuProjet", () => {
  it("sans chaîne reliée : texte historique mot pour mot", () => {
    const t = formaterJalonsDuProjet([j(1, "A", "active", null), j(2, "B", "locked", null)], [{ id: 1, title: "Obj" }]);
    expect(t).toBe(
      "## Jalons du projet\nJalons actifs/débloqués (tu PEUX générer des tâches pour ces jalons) :\n- ✅ A\n\n"
      + "Jalons BLOQUÉS (tu NE DOIS PAS générer de tâches pour ces jalons) :\n- 🔒 B (bloqué — condition non remplie)",
    );
  });

  it("groupé par objectif : étape en cours, suivantes verrouillées, franchies", () => {
    const t = formaterJalonsDuProjet([
      j(1, "Fondations", "completed", 1, 0), j(2, "Prospecter", "active", 1, 1, "remplir le pipeline"), j(3, "Signer", "locked", 1, 2),
      j(4, "Publier", "unlocked", 2, 0), j(5, "Projet seul", "locked", null),
    ], [{ id: 1, title: "3 clients" }, { id: 2, title: "Visibilité" }])!;
    expect(t).toContain("Objectif « 3 clients » → étape en cours : ✅ « Prospecter » (tu PEUX générer des tâches pour cette étape) — pourquoi : remplir le pipeline");
    expect(t).toContain("Suivantes verrouillées (tu NE DOIS PAS générer de tâches pour elles) : 🔒 « Signer »");
    expect(t).toContain("Déjà franchies : « Fondations »");
    expect(t).toContain("Objectif « Visibilité » → étape en cours : ✅ « Publier »");
    expect(t).toContain("- 🔒 Projet seul (bloqué — condition non remplie)");
  });

  it("jalons d'un objectif non actif : rendus comme la chaîne de projet, le verrou reste dit", () => {
    const t = formaterJalonsDuProjet([j(1, "X", "locked", 9)], [])!;
    expect(t).toContain("- 🔒 X (bloqué");
  });

  it("objectif sans étape en cours", () => {
    const t = formaterJalonsDuProjet([j(1, "S", "locked", 1)], [{ id: 1, title: "O" }])!;
    expect(t).toContain("Objectif « O » → aucune étape en cours");
    expect(t).toContain("🔒 « S »");
  });
});
