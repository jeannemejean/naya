import { describe, it, expect } from "vitest";
import { joursDeLaSemaine, lundiDe } from "./semaine";

describe("semaine", () => {
  it("du lundi au dimanche, changement de mois compris", () =>
    expect(joursDeLaSemaine(lundiDe("2026-11-01"))).toEqual(
      ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]));
  it("le mardi 20 oct. 2026 est dans la semaine du 19", () => expect(lundiDe("2026-10-20")).toBe("2026-10-19"));
});
