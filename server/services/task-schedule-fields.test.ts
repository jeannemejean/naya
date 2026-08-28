import { describe, it, expect } from "vitest";
import { resolveScheduledEndTime, blockedRangesByDate } from "./task-schedule-fields";

describe("resolveScheduledEndTime", () => {
  it("calcule l'heure de fin depuis l'heure de début et la durée", () => {
    expect(resolveScheduledEndTime("14:00", 45)).toBe("14:45");
  });

  it("passe l'heure ronde correctement", () => {
    expect(resolveScheduledEndTime("14:40", 30)).toBe("15:10");
  });

  it("retombe sur 30 min quand la durée est absente", () => {
    expect(resolveScheduledEndTime("09:00", null)).toBe("09:30");
  });

  it("ne produit jamais une heure invalide en fin de journée", () => {
    // Avant, le calcul en ligne de la route produisait « 24:15 », que la grille
    // ne sait pas lire (timeToMinutes → 1455 min, hors grille).
    expect(resolveScheduledEndTime("23:30", 45)).toBe("23:59");
  });

  it("renvoie null sans heure de début (tâche « à planifier »)", () => {
    expect(resolveScheduledEndTime(null, 45)).toBeNull();
  });

  it("renvoie null sur une heure malformée plutôt qu'une heure fausse", () => {
    expect(resolveScheduledEndTime("plus tard", 45)).toBeNull();
  });
});

describe("blockedRangesByDate", () => {
  it("réserve le créneau d'une tâche terminée", () => {
    // LE bug d'origine : cocher une tâche « libérait » son créneau pour le
    // planificateur alors que la grille continue de l'afficher — la tâche suivante
    // venait s'empiler dessus, et aucun re-tassage ne le corrigeait ensuite.
    const map = blockedRangesByDate([
      { completed: true, scheduledDate: "2026-08-27", scheduledTime: "09:00", estimatedDuration: 45 },
    ]);
    expect(map.get("2026-08-27")).toEqual([{ start: 540, end: 585 }]);
  });

  it("ignore les tâches non terminées (elles, le re-tassage peut les déplacer)", () => {
    const map = blockedRangesByDate([
      { completed: false, scheduledDate: "2026-08-27", scheduledTime: "09:00", estimatedDuration: 45 },
    ]);
    expect(map.size).toBe(0);
  });

  it("ignore une tâche terminée sans créneau", () => {
    const map = blockedRangesByDate([
      { completed: true, scheduledDate: "2026-08-27", scheduledTime: null, estimatedDuration: 45 },
    ]);
    expect(map.size).toBe(0);
  });

  it("retombe sur 30 min quand la durée manque", () => {
    const map = blockedRangesByDate([
      { completed: true, scheduledDate: "2026-08-27", scheduledTime: "10:00", estimatedDuration: null },
    ]);
    expect(map.get("2026-08-27")).toEqual([{ start: 600, end: 630 }]);
  });

  it("regroupe plusieurs tâches terminées par date", () => {
    const map = blockedRangesByDate([
      { completed: true, scheduledDate: "2026-08-27", scheduledTime: "09:00", estimatedDuration: 30 },
      { completed: true, scheduledDate: "2026-08-27", scheduledTime: "11:00", estimatedDuration: 60 },
      { completed: true, scheduledDate: "2026-08-28", scheduledTime: "14:00", estimatedDuration: 30 },
    ]);
    expect(map.get("2026-08-27")).toHaveLength(2);
    expect(map.get("2026-08-28")).toEqual([{ start: 840, end: 870 }]);
  });
});
