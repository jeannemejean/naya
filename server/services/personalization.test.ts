import { describe, it, expect } from "vitest";
import { renderTemplate, leadVars } from "./personalization";

describe("leadVars", () => {
  it("dérive firstName/lastName depuis le nom complet", () => {
    const v = leadVars({ name: "Marie Dupont", company: "Encore Merci", role: "CMO", sector: "Mode" });
    expect(v.firstName).toBe("Marie");
    expect(v.lastName).toBe("Dupont");
    expect(v.company).toBe("Encore Merci");
    expect(v.role).toBe("CMO");
  });
  it("gère un prénom seul", () => {
    expect(leadVars({ name: "Marie" }).firstName).toBe("Marie");
    expect(leadVars({ name: "Marie" }).lastName).toBe("");
  });
  it("gère les champs absents", () => {
    const v = leadVars({});
    expect(v.firstName).toBe("");
    expect(v.company).toBe("");
  });
});

describe("renderTemplate", () => {
  const vars = { firstName: "Marie", company: "Encore Merci", role: "" };
  it("remplace une variable connue", () => {
    expect(renderTemplate("Bonjour {{firstName}},", vars)).toBe("Bonjour Marie,");
  });
  it("remplace plusieurs variables", () => {
    expect(renderTemplate("{{firstName}} chez {{company}}", vars)).toBe("Marie chez Encore Merci");
  });
  it("utilise le fallback si la variable est vide", () => {
    expect(renderTemplate("Bonjour {{firstName|toi}},", { firstName: "" })).toBe("Bonjour toi,");
    expect(renderTemplate("Salut {{role|là}}", vars)).toBe("Salut là");
  });
  it("variable connue non vide ignore le fallback", () => {
    expect(renderTemplate("{{firstName|toi}}", vars)).toBe("Marie");
  });
  it("variable inconnue → vide (ou fallback)", () => {
    expect(renderTemplate("X{{inconnue}}Y", vars)).toBe("XY");
    expect(renderTemplate("X{{inconnue|Z}}Y", vars)).toBe("XZY");
  });
  it("tolère les espaces dans les accolades", () => {
    expect(renderTemplate("Bonjour {{ firstName }}", vars)).toBe("Bonjour Marie");
  });
  it("laisse le texte sans variable intact", () => {
    expect(renderTemplate("Aucune variable ici.", vars)).toBe("Aucune variable ici.");
  });
});
