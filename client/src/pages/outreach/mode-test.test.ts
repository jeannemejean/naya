import { describe, it, expect } from "vitest";
import fr from "@/locales/fr";
import en from "@/locales/en";
import { codeRefusTest, emailTestValide, estLeadTest, CODES_REFUS_TEST } from "./mode-test";

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
  });

  it("chaque code a son message, en français et en anglais", () => {
    for (const code of CODES_REFUS_TEST) {
      expect((fr as any).outreach.modeTest.erreurs[code]).toBeTruthy();
      expect((en as any).outreach.modeTest.erreurs[code]).toBeTruthy();
    }
  });

  it("reconnaît le prospect test par sa marque", () => {
    expect(estLeadTest({ tags: ["naya_test"] })).toBe(true);
    expect(estLeadTest({ tags: [] })).toBe(false);
  });
});
