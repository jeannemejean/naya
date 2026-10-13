import { describe, it, expect } from "vitest";
import { couverture } from "./couverture";

const motivations = [
  { cle: "efficacite", nom: "Efficacité" },
  { cle: "cadeau", nom: "Cadeau" },
];
const c = (id: number, angle: string | null, publie = false) => ({ id, angle, status: publie ? "published" : "draft", publishedAt: publie ? new Date() : null });

describe("couverture", () => {
  it("compte par motivation, sans score inventé", () => {
    const r = couverture(motivations as any, [c(1, "efficacite", true), c(2, "efficacite"), c(3, "aucun"), c(4, null)], [{ contentId: 1, score: 0.6 }]);
    expect(r.lignes).toEqual([
      { cle: "efficacite", nom: "Efficacité", contenus: 2, publies: 1, score: 0.6 },
      { cle: "cadeau", nom: "Cadeau", contenus: 0, publies: 0, score: null },
    ]);
    expect(r.horsMotivations).toBe(1);
    expect(r.nonEtiquetes).toBe(1);
    expect(r.jamaisExploitees).toEqual(["cadeau"]);
  });

  it("moyenne des scores présents seulement", () => {
    const r = couverture(motivations as any, [c(1, "cadeau"), c(2, "cadeau"), c(3, "cadeau")], [{ contentId: 1, score: 1 }, { contentId: 2, score: 0 }]);
    expect(r.lignes[1].score).toBe(0.5);
  });

  it("un angle retiré des motivations reste visible, marqué retiré", () => {
    const r = couverture(motivations as any, [c(1, "naturalite")], []);
    expect(r.lignes[2]).toEqual({ cle: "naturalite", nom: "naturalite", contenus: 1, publies: 0, score: null, retiree: true });
  });
});
