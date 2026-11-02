import { describe, it, expect } from "vitest";
import fr from "@/locales/fr";
import en from "@/locales/en";
import { cleErreurEnvoi, cleErreurPasUneReponse, typeBulle, ordonnerFil, dateRelative } from "./reponses-logique";

const lire = (o: any, cle: string) => cle.split(".").reduce((x, k) => x?.[k], o);

describe("raison -> message", () => {
  const raisons = ["envoi_coupe", "compte_restreint", "compte_deconnecte", "compte_absent", "envoi_en_cours", "deja_envoye", "texte_vide", "texte_trop_long", "introuvable", "echec"];
  it("chaque raison a un message en français et en anglais", () => {
    for (const r of raisons) {
      const cle = cleErreurEnvoi(r);
      expect(typeof lire(fr, cle)).toBe("string");
      expect(typeof lire(en, cle)).toBe("string");
    }
  });
  it("raison inconnue : message générique", () => {
    expect(cleErreurEnvoi("zzz")).toBe("outreach.reponses.erreurs.echec");
    expect(cleErreurEnvoi(undefined)).toBe("outreach.reponses.erreurs.echec");
  });
  it("pas une réponse", () => {
    expect(cleErreurPasUneReponse("deja_repondu")).toContain("dejaRepondu");
    expect(cleErreurPasUneReponse(undefined)).toContain("echec");
    for (const c of [cleErreurPasUneReponse("deja_repondu"), cleErreurPasUneReponse(null), "outreach.reponses.pasUneReponse.autreEnAttente"]) {
      expect(typeof lire(fr as any, c)).toBe("string");
      expect(typeof lire(en as any, c)).toBe("string");
    }
  });
});

describe("fil", () => {
  it("types de bulle", () => {
    expect(typeBulle({ sens: "entrant", nature: "reponse" })).toBe("entrant");
    expect(typeBulle({ sens: "sortant", nature: "nous" })).toBe("sortant");
    expect(typeBulle({ sens: "sortant", nature: "en_attente" })).toBe("en_attente");
    expect(typeBulle({ sens: "entrant", nature: "absence" })).toBe("discret");
    expect(typeBulle({ sens: "entrant", nature: "accuse" })).toBe("discret");
  });
  it("ordre chronologique stable, entrée intacte", () => {
    const m = [{ id: "b", sentAt: "2026-11-02T10:00:00Z" }, { id: "a", sentAt: "2026-11-01T10:00:00Z" }, { id: "c", sentAt: "2026-11-02T10:00:00Z" }];
    expect(ordonnerFil(m).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(m[0].id).toBe("b");
  });
  it("date relative", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(dateRelative("2026-11-02T09:00:00Z", now, "fr")).toMatch(/3\s*h/);
    expect(dateRelative("2026-11-02T11:59:40Z", now, "fr")).toBe("à l'instant");
    expect(dateRelative("2026-11-02T11:59:40Z", now, "en")).toBe("just now");
    expect(dateRelative(null, now, "fr")).toBe("");
  });
});
