import { describe, it, expect } from "vitest";
import { buildStepPrompt } from "./sequence-message";

describe("buildStepPrompt", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD",
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" },
    audit: { angle: "le nom crée une pause", observations: "marque outdoor grenobloise" },
  };
  it("LinkedIn : impose ≤200 caractères et la signature du prénom", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(p).toContain("200");
    expect(p).toContain("Jeanne");
    expect(p).toContain("Fred Renaud");
    expect(p).toContain("Invitation d'ouverture");
  });
  it("Email : demande un objet + un corps et rappelle l'intention", () => {
    const p = buildStepPrompt({ ...base, channel: "email", intention: "Email de valeur" });
    expect(p.toLowerCase()).toContain("objet");
    expect(p).toContain("Email de valeur");
  });
});
