import { describe, it, expect } from "vitest";
import { deriveMilestoneDate, addDays, toDateStr } from "./milestone-dates";

describe("addDays", () => {
  it("ajoute des jours sans dérive de fuseau", () => {
    expect(addDays("2026-06-21", 1)).toBe("2026-06-22");
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("toDateStr", () => {
  it("normalise Date et chaîne ISO", () => {
    expect(toDateStr("2026-06-21T08:30:00.000Z")).toBe("2026-06-21");
    expect(toDateStr(new Date("2026-06-21T23:00:00.000Z"))).toBe("2026-06-21");
    expect(toDateStr(null)).toBeNull();
  });
});

describe("deriveMilestoneDate — priorité", () => {
  it("1. terminé → date de réalisation (completedAt)", () => {
    expect(deriveMilestoneDate({ status: "completed", completedAt: "2026-06-10T12:00:00Z", targetDate: "2026-07-01" }))
      .toBe("2026-06-10");
  });

  it("2. date cible explicite prioritaire sur les tâches/durée", () => {
    expect(deriveMilestoneDate({
      status: "active", targetDate: "2026-07-15",
      activatedAt: "2026-06-01T00:00:00Z", durationDays: 10,
      linkedTaskDates: ["2026-06-20"],
    })).toBe("2026-07-15");
  });

  it("3. condition de durée → activé + N jours", () => {
    expect(deriveMilestoneDate({ status: "active", activatedAt: "2026-06-01T00:00:00Z", durationDays: 10 }))
      .toBe("2026-06-11");
  });

  it("4. dernière tâche liée (max des dates)", () => {
    expect(deriveMilestoneDate({ status: "unlocked", linkedTaskDates: ["2026-06-18", "2026-06-25", "2026-06-20"] }))
      .toBe("2026-06-25");
  });

  it("5. après le jalon dont il dépend (+1 jour)", () => {
    expect(deriveMilestoneDate({ status: "locked", depDate: "2026-06-30" })).toBe("2026-07-01");
  });

  it("6. indatable → null", () => {
    expect(deriveMilestoneDate({ status: "active" })).toBeNull();
    expect(deriveMilestoneDate({ status: "active", linkedTaskDates: [null, undefined] })).toBeNull();
  });

  it("ignore la durée si activatedAt manquant", () => {
    expect(deriveMilestoneDate({ status: "active", durationDays: 5 })).toBeNull();
  });
});
