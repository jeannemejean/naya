// Relance de la validation DANS la même écriture que la modification : jamais une fenêtre où
// le post modifié reste « validé » (le worker le publierait tel quel).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ journaliser: vi.fn(async () => {}) }));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../gestion-posts/historique", () => ({ journaliser: h.journaliser }));
const { champsRelanceValidation, journaliserRelanceSiEdite } = await import("./relance");
const sqlDe = (v: any) => new PgDialect().sqlToQuery(v).sql;

beforeEach(() => vi.clearAllMocks());

describe("champsRelanceValidation", () => {
  it("rien de ce qui part ne change : aucun champ ajouté", () => {
    expect(champsRelanceValidation({ id: 1, body: "a", validationStatut: "validee" }, { body: "a", pillar: "x" })).toEqual({});
  });
  it("post hors validation : aucun champ ajouté (l'écriture reste celle d'avant)", () => {
    expect(champsRelanceValidation({ id: 1, body: "a", validationStatut: null }, { body: "b" })).toEqual({});
  });
  it("texte changé : statut et date de demande dans la même écriture, conditionnés en SQL", () => {
    const c: any = champsRelanceValidation({ id: 1, body: "a", validationStatut: "validee" }, { body: "b" });
    expect(sqlDe(c.validationStatut)).toMatch(/case when "content"\."validation_statut" in \('a_valider', 'validee', 'refusee'\) then 'a_valider' else "content"\."validation_statut" end/);
    expect(sqlDe(c.validationDemandeeAt)).toMatch(/case when "content"\."validation_statut" in .* then now\(\) else "content"\."validation_demandee_at" end/);
  });
});

describe("journaliserRelanceSiEdite", () => {
  it("journalise seulement un post qui était en validation", async () => {
    await journaliserRelanceSiEdite("u", { id: 1, body: "a", validationStatut: null }, { body: "b" });
    expect(h.journaliser).not.toHaveBeenCalled();
    await journaliserRelanceSiEdite("u", { id: 1, body: "a", validationStatut: "validee" }, { body: "b" });
    expect(h.journaliser).toHaveBeenCalledWith("u", 1, "validation_relancee", { avant: "validee" });
  });
});
