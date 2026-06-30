import { describe, it, expect } from "vitest";
import { selectOverdueTasks } from "./overdue-tasks";

const TODAY = "2026-06-30";

describe("selectOverdueTasks — section « Non planifiées » (4 conditions)", () => {
  it("Condition 1 : une tâche de la semaine PASSÉE (sans heure) apparaît, même au-delà de la frontière de semaine", () => {
    const tasks = [
      { id: 1, completed: false, scheduledDate: "2026-06-18", scheduledTime: null }, // > 1 semaine avant
      { id: 2, completed: false, scheduledDate: "2026-06-29", scheduledTime: null }, // hier
    ];
    const out = selectOverdueTasks(tasks as any, TODAY);
    expect(out.map((t: any) => t.id)).toEqual([1, 2]);
  });

  it("Condition 2 : une tâche d'AUJOURD'HUI (déjà dans Today) ne duplique PAS ici", () => {
    const tasks = [
      { id: 1, completed: false, scheduledDate: TODAY },           // aujourd'hui → exclu
      { id: 2, completed: false, scheduledDate: "2026-07-02" },    // futur → exclu
      { id: 3, completed: false, scheduledDate: "2026-06-28" },    // passé → inclus
    ];
    expect(selectOverdueTasks(tasks as any, TODAY).map((t: any) => t.id)).toEqual([3]);
  });

  it("Condition 4 : aucune tâche orpheline → liste vide (la section sera masquée)", () => {
    const tasks = [
      { id: 1, completed: false, scheduledDate: TODAY },
      { id: 2, completed: true, scheduledDate: "2026-06-20" },     // complétée → exclue
    ];
    expect(selectOverdueTasks(tasks as any, TODAY)).toEqual([]);
  });

  it("exclut complétées, archivées, jalons et événements agenda", () => {
    const tasks = [
      { id: 1, completed: true, scheduledDate: "2026-06-20" },
      { id: 2, completed: false, archivedAt: new Date(), scheduledDate: "2026-06-20" },
      { id: 3, completed: false, type: "milestone", scheduledDate: "2026-06-20" },
      { id: 4, completed: false, source: "gcal", scheduledDate: "2026-06-20" },
      { id: 5, completed: false, scheduledDate: null },            // sans date → exclu
      { id: 6, completed: false, scheduledDate: "2026-06-20" },    // le seul valide
    ];
    expect(selectOverdueTasks(tasks as any, TODAY).map((t: any) => t.id)).toEqual([6]);
  });
});
