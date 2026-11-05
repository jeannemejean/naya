import { describe, it, expect } from "vitest";
import fr from "@/locales/fr";
import en from "@/locales/en";
import { codeRefusTest, emailTestValide, estLeadTest, prospectsApercu, CODES_REFUS_TEST } from "./mode-test";

describe("mode test — client", () => {
  it("valide l'adresse comme le serveur", () => {
    expect(emailTestValide("claire@exemple.fr")).toBe(true);
    expect(emailTestValide("  claire@exemple.fr ")).toBe(true);
    expect(emailTestValide("")).toBe(false);
    expect(emailTestValide("claire@exemple")).toBe(false);
  });

  it("lit le code de refus de l'erreur d'apiRequest", () => {
    expect(codeRefusTest(new Error('409: {"message":"gmail_deconnecte"}'))).toBe("gmail_deconnecte");
    expect(codeRefusTest(new Error('429: {"message":"quota_atteint"}'))).toBe("quota_atteint");
    expect(codeRefusTest(new Error("500: Internal Server Error"))).toBe("echec_envoi");
    expect(codeRefusTest(new Error('409: {"message":"inconnu"}'))).toBe("echec_envoi");
    expect(codeRefusTest(new Error('409: {"message":"adresse_prospect"}'))).toBe("adresse_prospect");
    expect(codeRefusTest(new Error('429: {"message":"quota_test_atteint"}'))).toBe("quota_test_atteint");
  });

  it("chaque code a son message, en français et en anglais", () => {
    for (const code of CODES_REFUS_TEST) {
      expect((fr as any).outreach.modeTest.erreurs[code]).toBeTruthy();
      expect((en as any).outreach.modeTest.erreurs[code]).toBeTruthy();
    }
  });

  it("messages exacts des deux nouveaux refus", () => {
    expect(fr.outreach.modeTest.erreurs.adresse_prospect).toBe("Cette adresse est celle d'un vrai prospect : choisis une de tes adresses.");
    expect(fr.outreach.modeTest.erreurs.quota_test_atteint).toBe("Tu as déjà envoyé 5 tests aujourd'hui.");
  });

  it("l'Aperçu ne propose jamais un prospect test", () => {
    const leads = [
      { id: 1, prospectionCampaignId: 7, archivedAt: null, tags: null },
      { id: 2, prospectionCampaignId: 7, archivedAt: null, tags: ["naya_test"] },
      { id: 3, prospectionCampaignId: 7, archivedAt: "2026-11-01", tags: null },
      { id: 4, prospectionCampaignId: 8, archivedAt: null, tags: null },
    ];
    expect(prospectsApercu(leads, 7).map((l) => l.id)).toEqual([1]);
  });

  it("reconnaît le prospect test par sa marque", () => {
    expect(estLeadTest({ tags: ["naya_test"] })).toBe(true);
    expect(estLeadTest({ tags: [] })).toBe(false);
  });
});
