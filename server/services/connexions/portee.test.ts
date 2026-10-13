import { describe, it, expect } from "vitest";
import { porteeDe, dansPortee, choisirCompte, identiteEnvoi } from "./portee";

const igJeanne = { id: 1, platform: "instagram", projectId: null, isActive: true };
const igClient = { id: 2, platform: "instagram", projectId: 7, isActive: true };
const igAutreClient = { id: 3, platform: "instagram", projectId: 8, isActive: true };
const liJeanne = { id: 4, platform: "linkedin", projectId: null, isActive: true };

describe("porteeDe", () => {
  it("un projet client est son propre périmètre", () => {
    expect(porteeDe({ id: 7, projectKind: "client" })).toBe(7);
  });
  it("projet perso, absent ou inconnu → périmètre de l'utilisatrice", () => {
    expect(porteeDe({ id: 5, projectKind: "personal" })).toBeNull();
    expect(porteeDe({ id: 5 })).toBeNull();
    expect(porteeDe(null)).toBeNull();
    expect(porteeDe(undefined)).toBeNull();
  });
});

describe("dansPortee", () => {
  it("compare le projet du compte au périmètre (absent = utilisatrice)", () => {
    expect(dansPortee(igJeanne, null)).toBe(true);
    expect(dansPortee({ id: 9, platform: "x" }, null)).toBe(true);
    expect(dansPortee(igClient, null)).toBe(false);
    expect(dansPortee(igClient, 7)).toBe(true);
    expect(dansPortee(igJeanne, 7)).toBe(false);
  });
});

describe("choisirCompte", () => {
  const tous = [igJeanne, igClient, igAutreClient, liJeanne];
  it("client sans compte de la plateforme : jamais celui de l'utilisatrice", () => {
    expect(choisirCompte([igJeanne, liJeanne], { platform: "instagram" }, 7)).toEqual({ erreur: "compte_absent" });
  });
  it("prend le compte du périmètre, jamais celui d'un autre client", () => {
    expect(choisirCompte(tous, { platform: "Instagram" }, 7)).toEqual({ compte: igClient });
    expect(choisirCompte(tous, { platform: "instagram" }, null)).toEqual({ compte: igJeanne });
    expect(choisirCompte([igAutreClient], { platform: "instagram" }, 7)).toEqual({ erreur: "compte_absent" });
  });
  it("compte lié hors périmètre : refus, aucun remplacement", () => {
    expect(choisirCompte(tous, { platform: "instagram", socialAccountId: 1 }, 7)).toEqual({ erreur: "compte_hors_projet" });
    expect(choisirCompte(tous, { platform: "instagram", socialAccountId: 2 }, null)).toEqual({ erreur: "compte_hors_projet" });
    expect(choisirCompte(tous, { platform: "instagram", socialAccountId: 42 }, null)).toEqual({ erreur: "compte_hors_projet" });
  });
  it("compte lié dans le périmètre : retenu", () => {
    expect(choisirCompte(tous, { platform: "instagram", socialAccountId: 2 }, 7)).toEqual({ compte: igClient });
  });
  it("ignore un compte inactif", () => {
    expect(choisirCompte([{ ...igClient, isActive: false }], { platform: "instagram" }, 7)).toEqual({ erreur: "compte_absent" });
  });
});

describe("identiteEnvoi", () => {
  const prefs = {
    prospectionSenderEmail: "jeanne@jmd.com", prospectionSenderName: "Jeanne", prospectionSendgridApiKey: "cle-j",
    prospectionSenderAddress: "1 rue", prospectionSenderCity: "Lyon", prospectionSenderCountry: "France",
    linkedinUnipileAccountId: "uni-j", linkedinAccountConnectedAt: "2026-09-01T00:00:00Z",
    linkedinRestrictedAt: null, linkedinRestrictedReason: null,
  };
  const connexion = {
    senderEmail: "marc@client.fr", senderName: "Marc Dupont", sendgridApiKey: "cle-c",
    senderAddress: "2 av", senderCity: "Paris", senderCountry: "France",
    linkedinUnipileAccountId: "uni-c", linkedinAccountConnectedAt: "2026-10-01T00:00:00Z",
    linkedinRestrictedAt: "2026-10-10T00:00:00Z", linkedinRestrictedReason: "limite",
  };
  it("périmètre utilisatrice : ses réglages, signature non imposée", () => {
    const id = identiteEnvoi(null, prefs, connexion);
    expect(id.email).toEqual({ fromEmail: "jeanne@jmd.com", fromName: "Jeanne", apiKeyChiffree: "cle-j", footerAddress: "1 rue, Lyon, France" });
    expect(id.linkedin?.accountId).toBe("uni-j");
    expect(id.linkedin?.restriction).toBeNull();
    expect(id.signature).toBeNull();
  });
  it("périmètre client : seulement la connexion du client", () => {
    const id = identiteEnvoi(7, prefs, connexion);
    expect(id.email).toEqual({ fromEmail: "marc@client.fr", fromName: "Marc Dupont", apiKeyChiffree: "cle-c", footerAddress: "2 av, Paris, France" });
    expect(id.linkedin?.accountId).toBe("uni-c");
    expect(id.linkedin?.connectedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(id.linkedin?.restriction).toEqual({ restrictedAt: new Date("2026-10-10T00:00:00Z"), reason: "limite" });
    expect(id.signature).toBe("Marc Dupont");
  });
  it("client sans connexion : tout est absent, jamais les réglages de l'utilisatrice", () => {
    expect(identiteEnvoi(7, prefs, null)).toEqual({ email: null, linkedin: null, signature: null });
    expect(identiteEnvoi(7, prefs, { senderEmail: "  ", senderName: " " })).toEqual({ email: null, linkedin: null, signature: null });
  });
});
