import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { basculerDansListe, cocherDansLeCache, estCleListeTaches } from "./cochage-optimiste";

const quand = new Date("2026-10-09T10:00:00Z");

describe("basculerDansListe", () => {
  it("coche puis décoche la tâche visée seulement", () => {
    const liste = [{ id: 1, completed: false }, { id: 2, completed: false }];
    const cochee = basculerDansListe(liste, 1, quand) as any[];
    expect(cochee[0]).toEqual({ id: 1, completed: true, completedAt: "2026-10-09T10:00:00.000Z" });
    expect(cochee[1]).toBe(liste[1]);
    const decochee = basculerDansListe(cochee, 1, quand) as any[];
    expect(decochee[0]).toEqual({ id: 1, completed: false, completedAt: null });
  });
  it("rend la même référence si la tâche n'y est pas, ou si ce n'est pas une liste", () => {
    const liste = [{ id: 2, completed: false }];
    expect(basculerDansListe(liste, 1)).toBe(liste);
    const obj = { a: 1 };
    expect(basculerDansListe(obj, 1)).toBe(obj);
  });
});

describe("estCleListeTaches", () => {
  it("vise les listes de tâches, pas les dépendances ni les livrables", () => {
    expect(estCleListeTaches(["/api/tasks"])).toBe(true);
    expect(estCleListeTaches(["/api/tasks/range", "2026-10-09", "2026-10-15", null])).toBe(true);
    expect(estCleListeTaches(["/api/tasks/dependencies", 1])).toBe(false);
    expect(estCleListeTaches(["/api/tasks/5/livrables"])).toBe(false);
    expect(estCleListeTaches(["/api/leads"])).toBe(false);
  });
});

describe("cocherDansLeCache", () => {
  it("bascule dans toutes les listes et sait annuler", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["/api/tasks"], [{ id: 7, completed: false }]);
    qc.setQueryData(["/api/tasks/range", "a", "b"], [{ id: 7, completed: false }, { id: 8, completed: true }]);
    qc.setQueryData(["/api/leads"], [{ id: 7, completed: false }]);

    const annuler = await cocherDansLeCache(qc, 7);
    expect((qc.getQueryData(["/api/tasks"]) as any[])[0].completed).toBe(true);
    expect((qc.getQueryData(["/api/tasks/range", "a", "b"]) as any[])[0].completed).toBe(true);
    expect((qc.getQueryData(["/api/leads"]) as any[])[0].completed).toBe(false);

    annuler();
    expect((qc.getQueryData(["/api/tasks"]) as any[])[0].completed).toBe(false);
    expect((qc.getQueryData(["/api/tasks/range", "a", "b"]) as any[])[0].completed).toBe(false);
  });
});
