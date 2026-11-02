import { describe, it, expect } from "vitest";
import { lignesReponsesBrief } from "./point-du-jour";

describe("lignesReponsesBrief", () => {
  it("rien à dire : aucune ligne", () => {
    expect(lignesReponsesBrief(0, [null, undefined, {}])).toEqual([]);
  });
  it("singulier et pluriel", () => {
    expect(lignesReponsesBrief(1, [])).toEqual(["- 1 réponse de prospects attend"]);
    expect(lignesReponsesBrief(3, [])).toEqual(["- 3 réponses de prospects attendent"]);
  });
  it("compte déconnecté : une ligne par canal, dédoublonnée entre périmètres", () => {
    const l = lignesReponsesBrief(0, [{ email: "2026-11-01T10:00:00Z" }, { email: "2026-11-02T10:00:00Z", linkedin: "2026-11-02T11:00:00Z" }]);
    expect(l).toEqual([
      "- Ton Gmail est déconnecté de Naya : les envois sur ce canal sont en pause",
      "- Ton LinkedIn est déconnecté de Naya : les envois sur ce canal sont en pause",
    ]);
  });
});
