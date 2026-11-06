import { describe, it, expect } from "vitest";
import { messagesSuppression, lotsDe, LOT_SUPPRESSION } from "./suppression-messages";

describe("messagesSuppression", () => {
  it("un prospect supprimé", () => {
    expect(messagesSuppression({ supprimes: 1, refuses: [] })).toEqual([{ cle: "outreach.suppression.succesUn", count: 1 }]);
  });
  it("plusieurs, avec refus comptés par raison", () => {
    expect(messagesSuppression({
      supprimes: 3,
      refuses: [{ id: 1, raison: "envoi_en_cours" }, { id: 2, raison: "introuvable" }, { id: 4, raison: "introuvable" }, { id: 5, raison: "erreur" }],
    })).toEqual([
      { cle: "outreach.suppression.succesPlusieurs", count: 3 },
      { cle: "outreach.suppression.envoiEnCours", count: 1, erreur: true },
      { cle: "outreach.suppression.introuvables", count: 2, erreur: true },
      { cle: "outreach.suppression.erreur", count: 1, erreur: true },
    ]);
  });
  it("rien supprimé, tout refusé : pas de message de succès", () => {
    expect(messagesSuppression({ supprimes: 0, refuses: [{ id: 1, raison: "envoi_en_cours" }] }).map((m) => m.cle))
      .toEqual(["outreach.suppression.envoiEnCours"]);
  });
});

describe("lotsDe (sélection > 100 prospects)", () => {
  it("lots de 100 au plus, dans l'ordre, rien de perdu", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const lots = lotsDe(ids);
    expect(LOT_SUPPRESSION).toBe(100);
    expect(lots.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(lots.flat()).toEqual(ids);
    expect(lotsDe([])).toEqual([]);
  });
});
