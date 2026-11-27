import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const { projetParDefautDe, avecProjetParDefaut, SOURCES_PERSO } = await import("./projet-par-defaut");

const P = (id: number, priorityLevel: string | null, projectStatus = "active") => ({ id, priorityLevel, projectStatus });

describe("projet par défaut (toute tâche est liée à un projet, ou au perso)", () => {
  it("le projet principal actif ; sinon le premier actif ; sinon le premier tout court ; sinon aucun", () => {
    expect(projetParDefautDe([P(16, "secondary"), P(15, "primary"), P(9, "primary", "paused")])).toBe(15);
    expect(projetParDefautDe([P(18, "secondary"), P(16, "secondary")])).toBe(16);
    expect(projetParDefautDe([P(4, "primary", "archived"), P(3, null, "paused")])).toBe(3);
    expect(projetParDefautDe([])).toBeNull();
  });
  it("une tâche sans projet reçoit le projet par défaut ; une tâche perso ou déjà rattachée ne bouge pas", async () => {
    const charger = vi.fn(async () => 15);
    expect(await avecProjetParDefaut({ userId: "u", source: "campaign", projectId: null }, charger)).toMatchObject({ projectId: 15 });
    expect(await avecProjetParDefaut({ userId: "u", source: "fil_cloture" }, charger)).toMatchObject({ projectId: 15 });
    expect(await avecProjetParDefaut({ userId: "u", source: "manual", projectId: 18 }, charger)).toMatchObject({ projectId: 18 });
    for (const s of SOURCES_PERSO) expect(await avecProjetParDefaut({ userId: "u", source: s, projectId: null }, charger)).toMatchObject({ projectId: null });
    expect(charger).toHaveBeenCalledTimes(2);
  });
  it("aucun projet chez elle, ou lecture ratée : la tâche est créée quand même, sans projet", async () => {
    expect((await avecProjetParDefaut({ userId: "u", source: "x" } as any, async () => null)).projectId).toBeUndefined();
    expect(await avecProjetParDefaut({ userId: "u", source: "x" }, async () => { throw new Error("db"); })).toMatchObject({ source: "x" });
  });
});
