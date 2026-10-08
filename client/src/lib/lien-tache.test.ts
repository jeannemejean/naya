import { describe, it, expect } from "vitest";
import { lienInterneDeTache, ongletDepuisRecherche } from "./lien-tache";

describe("lienInterneDeTache", () => {
  it("rend le lien interne porté par actionData", () => {
    expect(lienInterneDeTache({ actionData: { lien: "/outreach/campaigns/7?onglet=prospects" } })).toBe(
      "/outreach/campaigns/7?onglet=prospects",
    );
  });
  it("refuse tout lien externe ou protocole-relatif", () => {
    expect(lienInterneDeTache({ actionData: { lien: "https://evil.example" } })).toBeNull();
    expect(lienInterneDeTache({ actionData: { lien: "//evil.example" } })).toBeNull();
    expect(lienInterneDeTache({ actionData: { lien: "javascript:alert(1)" } })).toBeNull();
  });
  it("sans actionData ou sans lien → null", () => {
    expect(lienInterneDeTache(null)).toBeNull();
    expect(lienInterneDeTache({})).toBeNull();
    expect(lienInterneDeTache({ actionData: { lien: 42 } })).toBeNull();
  });
});

describe("ongletDepuisRecherche", () => {
  const permis = ["sequence", "prospects", "preview", "results"] as const;
  it("lit ?onglet= quand il est permis", () => {
    expect(ongletDepuisRecherche("?onglet=prospects", permis, "sequence")).toBe("prospects");
  });
  it("valeur inconnue ou absente → défaut", () => {
    expect(ongletDepuisRecherche("?onglet=autre", permis, "sequence")).toBe("sequence");
    expect(ongletDepuisRecherche("", permis, "sequence")).toBe("sequence");
  });
});
