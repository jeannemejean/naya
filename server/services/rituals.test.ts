import { describe, it, expect } from "vitest";
import { ritualOccursOn, buildRitualTask, isValidTimeOfDay, areValidDays } from "./rituals";
import type { RecurringRitual } from "@shared/schema";

const RITUAL = {
  id: 1, userId: "u1", projectId: 3,
  title: "Brief news + posts JMD",
  days: "mon,tue,wed,thu,fri",
  startTime: "09:00",
  durationMinutes: 20,
  active: true,
  createdAt: null,
} as unknown as RecurringRitual;

describe("ritualOccursOn", () => {
  it("reconnaît un jour concerné", () => {
    // 2026-07-24 est un vendredi
    expect(ritualOccursOn("mon,tue,wed,thu,fri", "2026-07-24")).toBe(true);
  });

  it("exclut un jour non concerné", () => {
    // 2026-07-25 est un samedi
    expect(ritualOccursOn("mon,tue,wed,thu,fri", "2026-07-25")).toBe(false);
  });

  it("accepte un rituel de week-end (indépendant des jours ouvrés)", () => {
    expect(ritualOccursOn("sat,sun", "2026-07-25")).toBe(true);
  });

  it("tolère les espaces et les majuscules", () => {
    expect(ritualOccursOn("Mon, Fri", "2026-07-24")).toBe(true);
  });
});

describe("buildRitualTask", () => {
  it("calcule l'heure de fin à partir de la durée", () => {
    const t = buildRitualTask(RITUAL, "2026-07-24");
    expect(t.scheduledTime).toBe("09:00");
    expect(t.scheduledEndTime).toBe("09:20");
    expect(t.estimatedDuration).toBe(20);
    expect(t.scheduledDate).toBe("2026-07-24");
    expect(t.title).toBe("Brief news + posts JMD");
  });

  it("gère un passage d'heure", () => {
    const t = buildRitualTask({ ...RITUAL, startTime: "08:50", durationMinutes: 20 }, "2026-07-24");
    expect(t.scheduledEndTime).toBe("09:10");
  });

  it("ancre la tâche : schedulingMode 'fixed' pour que les autres tâches l'évitent", () => {
    const t = buildRitualTask(RITUAL, "2026-07-24");
    expect(t.schedulingMode).toBe("fixed");
    expect(t.source).toBe("ritual");
  });
});

describe("isValidTimeOfDay", () => {
  it("accepte les heures valides", () => {
    expect(isValidTimeOfDay("09:00")).toBe(true);
    expect(isValidTimeOfDay("23:59")).toBe(true);
    expect(isValidTimeOfDay("00:00")).toBe(true);
  });

  it("rejette les heures hors bornes ou mal formées", () => {
    expect(isValidTimeOfDay("99:99")).toBe(false);
    expect(isValidTimeOfDay("24:00")).toBe(false);
    expect(isValidTimeOfDay("12:60")).toBe(false);
    expect(isValidTimeOfDay("9:00")).toBe(false);
    expect(isValidTimeOfDay("0900")).toBe(false);
    expect(isValidTimeOfDay("")).toBe(false);
  });
});

describe("areValidDays", () => {
  it("accepte des listes de jours valides, avec espaces/majuscules tolérés", () => {
    expect(areValidDays("mon,tue,wed,thu,fri")).toBe(true);
    expect(areValidDays("sat,sun")).toBe(true);
    expect(areValidDays("Mon, Fri")).toBe(true);
  });

  it("rejette les jours invalides ou l'absence de jours", () => {
    expect(areValidDays("xyz")).toBe(false);
    expect(areValidDays("lundi")).toBe(false);
    expect(areValidDays("")).toBe(false);
    expect(areValidDays("mon,xyz")).toBe(false);
  });
});
