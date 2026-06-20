import { describe, it, expect } from "vitest";
import { extractLinkedInLead } from "./serp";

describe("extractLinkedInLead", () => {
  it("extrait nom + URL d'un résultat LinkedIn /in/", () => {
    const r = extractLinkedInLead({
      link: "https://fr.linkedin.com/in/solene-jaboulet-7799b9?trk=abc",
      title: "Solene JABOULET - Directrice Marketing et Communication - Cité du Vin | LinkedIn",
      description: "Directrice Marketing, Cité du Vin",
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Solene JABOULET");
    expect(r!.role).toBe("Directrice Marketing et Communication");
    expect(r!.company).toBe("Cité du Vin");
    expect(r!.linkedinUrl).toBe("https://fr.linkedin.com/in/solene-jaboulet-7799b9"); // query strippée
  });

  it("gère un titre nom + société (2 parties)", () => {
    const r = extractLinkedInLead({ link: "https://www.linkedin.com/in/x", title: "Marie Dupont - Encore Merci | LinkedIn" });
    expect(r!.name).toBe("Marie Dupont");
    expect(r!.company).toBe("Encore Merci");
    expect(r!.role).toBeNull();
  });

  it("gère un nom seul", () => {
    const r = extractLinkedInLead({ link: "https://linkedin.com/in/x", title: "Marie Dupont | LinkedIn" });
    expect(r!.name).toBe("Marie Dupont");
    expect(r!.role).toBeNull();
    expect(r!.company).toBeNull();
  });

  it("ignore un résultat non-profil (pas /in/)", () => {
    expect(extractLinkedInLead({ link: "https://www.linkedin.com/company/encore-merci", title: "Encore Merci | LinkedIn" })).toBeNull();
    expect(extractLinkedInLead({ link: "https://example.com/page", title: "Truc" })).toBeNull();
  });

  it("ignore si pas de nom", () => {
    expect(extractLinkedInLead({ link: "https://linkedin.com/in/x", title: " | LinkedIn" })).toBeNull();
  });
});
