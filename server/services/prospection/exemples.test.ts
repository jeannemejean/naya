import { describe, it, expect } from "vitest";
import { choisirExemples } from "./exemples";

const fb = (id: number, over: any = {}) => ({
  id, userId: "u", projectId: 7, campaignId: 1, leadId: id, stepId: 1, role: "premier_message",
  action: "valide_tel_quel", original: "o", final: `texte ${id}`, raison: null, defauts: null, aRepondu: null,
  createdAt: new Date(2026, 9, id), ...over,
});

describe("choisirExemples", () => {
  it("priorité : a obtenu une réponse, puis modifié, puis collé, puis validé tel quel", () => {
    const out = choisirExemples([
      fb(1),
      fb(2, { action: "modifie" }),
      fb(3, { action: "modifie", original: null }),
      fb(4, { aRepondu: true }),
    ] as any, "premier_message", 4);
    expect(out).toEqual(["texte 4", "texte 2", "texte 3", "texte 1"]);
  });

  it("ne garde que le rôle demandé, sans les messages écartés ni les contrôles", () => {
    const out = choisirExemples([
      fb(1, { role: "relance" }),
      fb(2, { action: "ecarte" }),
      fb(3, { action: "controle" }),
      fb(4),
    ] as any, "premier_message");
    expect(out).toEqual(["texte 4"]);
  });

  it("respecte le maximum et préfère les plus récents à priorité égale", () => {
    const out = choisirExemples([fb(1), fb(5), fb(3)] as any, "premier_message", 2);
    expect(out).toEqual(["texte 5", "texte 3"]);
  });

  it("ignore les textes vides et les doublons", () => {
    const out = choisirExemples([fb(1, { final: "  " }), fb(2, { final: "même" }), fb(3, { final: "même" })] as any, "premier_message");
    expect(out).toEqual(["même"]);
  });
});
