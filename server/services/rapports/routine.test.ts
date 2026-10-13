import { describe, it, expect, vi } from "vitest";
import { executerRapport, routineRapportPour, KIND_RAPPORT } from "./routine";

const routine = { id: 1, userId: "u", kind: KIND_RAPPORT, cible: { projectId: 7 } } as any;
const maintenant = () => new Date("2026-10-02T07:00:00Z");

describe("routine mensuelle du rapport client", () => {
  it("se crée le 2 du mois suivant à 7 h UTC (après le bilan de 5 h)", () => {
    const r = routineRapportPour({ userId: "u", projectId: 7 }, new Date("2026-10-13T10:00:00Z"));
    expect(r).toMatchObject({ kind: KIND_RAPPORT, cadence: "mensuelle", heureUtc: 7, cibleCle: "project:7" });
    expect(r.prochainPassage.toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });
  it("rapport du mois écoulé déjà là (brouillon ou publié) → rien, aucune préparation", async () => {
    const preparer = vi.fn();
    const r = await executerRapport(routine, { getProject: vi.fn(async () => ({ id: 7, projectKind: "client", name: "X" })), getRapport: vi.fn(async () => ({ statut: "brouillon" }) as any), preparer, maintenant });
    expect(r.statut).toBe("rien_a_faire");
    expect(preparer).not.toHaveBeenCalled();
  });
  it("prépare le mois écoulé et prévient l'utilisatrice", async () => {
    const preparer = vi.fn(async () => ({ statut: "ok", rapport: {} }) as any);
    const r = await executerRapport(routine, { getProject: vi.fn(async () => ({ id: 7, projectKind: "client", name: "Maison X" })), getRapport: vi.fn(async () => undefined), preparer, maintenant });
    expect(preparer).toHaveBeenCalledWith("u", 7, "2026-09");
    expect(r).toMatchObject({ statut: "ok", notifier: true });
    expect(r.resume).toContain("Maison X");
  });
  it("projet supprimé ou redevenu perso → routine désactivée", async () => {
    const preparer = vi.fn();
    expect((await executerRapport(routine, { getProject: vi.fn(async () => undefined), getRapport: vi.fn(), preparer, maintenant })).desactiver).toBe(true);
    expect((await executerRapport(routine, { getProject: vi.fn(async () => ({ id: 7, projectKind: "personal" })), getRapport: vi.fn(), preparer, maintenant })).desactiver).toBe(true);
    expect(preparer).not.toHaveBeenCalled();
  });
  it("aucune donnée → rien, sans notification ; sortie illisible → erreur", async () => {
    const base = { getProject: vi.fn(async () => ({ id: 7, projectKind: "client", name: "X" })), getRapport: vi.fn(async () => undefined), maintenant };
    const r1 = await executerRapport(routine, { ...base, preparer: vi.fn(async () => ({ statut: "rien" }) as any) });
    expect(r1.statut).toBe("rien_a_faire");
    expect(r1.notifier).toBeFalsy();
    const r2 = await executerRapport(routine, { ...base, preparer: vi.fn(async () => ({ statut: "illisible" }) as any) });
    expect(r2.statut).toBe("erreur");
  });
});
