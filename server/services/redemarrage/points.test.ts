import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const { pointsDe } = await import("./points");

describe("points faits en séance, par projet", () => {
  it("projets faits ou passés : date de fin de séance (ou de dernière mise à jour si elle est en cours) ; le plus récent l'emporte", () => {
    const p = pointsDe([
      { statut: "terminee", termineeAt: new Date("2026-11-27T10:00:00Z"), updatedAt: new Date("2026-11-27T10:00:00Z"),
        projets: [{ projectId: 15, etat: "fait" }, { projectId: 16, etat: "saute" }, { projectId: 17, etat: "a_faire" }] },
      { statut: "en_cours", termineeAt: null, updatedAt: new Date("2026-12-10T09:00:00Z"), projets: [{ projectId: 15, etat: "fait" }, { projectId: 18, etat: "en_cours" }] },
      { statut: "abandonnee", termineeAt: null, updatedAt: new Date("2026-12-20T09:00:00Z"), projets: [{ projectId: 16, etat: "fait" }] },
    ] as any);
    expect([...p.entries()]).toEqual([
      [15, new Date("2026-12-10T09:00:00Z")],
      [16, new Date("2026-11-27T10:00:00Z")],
    ]);
  });
});
