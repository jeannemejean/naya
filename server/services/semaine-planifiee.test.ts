import { describe, it, expect } from "vitest";
import { bornesSemaine, titresDejaPlanifies } from "./semaine-planifiee";

describe("semaine planifiée", () => {
  it("bornes lundi → dimanche, y compris un dimanche", () => {
    expect(bornesSemaine("2026-11-12")).toEqual(["2026-11-09", "2026-11-15"]);
    expect(bornesSemaine("2026-11-15")).toEqual(["2026-11-09", "2026-11-15"]);
    expect(bornesSemaine("2026-11-09")).toEqual(["2026-11-09", "2026-11-15"]);
  });

  it("titres sans jalons, sans archivées, sans doublon", () => {
    expect(titresDejaPlanifies([
      { title: "Chiffrer le devis" }, { title: " Chiffrer le devis " }, { title: "Jalon", type: "milestone" },
      { title: "Vieille", archivedAt: new Date() }, { title: "" }, { title: "Relire" },
    ])).toEqual(["Chiffrer le devis", "Relire"]);
  });
});
