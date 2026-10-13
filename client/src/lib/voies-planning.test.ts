import { describe, it, expect } from "vitest";
import { voiesPlanning } from "./voies-planning";

describe("voiesPlanning — deux éléments qui se touchent à l'écran ne s'empilent jamais", () => {
  it("rien ne se touche : une seule colonne chacun", () => {
    const v = voiesPlanning([{ id: 1, debut: 600, fin: 660 }, { id: 2, debut: 660, fin: 690 }]);
    expect(v.get(1)).toEqual({ voie: 0, total: 1 });
    expect(v.get(2)).toEqual({ voie: 0, total: 1 });
  });
  it("le 13 octobre : « Préparer le visuel » 14:00 et « Imetik » 14:00 côte à côte", () => {
    const v = voiesPlanning([{ id: 807, debut: 840, fin: 885 }, { id: -1, debut: 840, fin: 900 }]);
    expect(new Set([v.get(807)!.voie, v.get(-1)!.voie])).toEqual(new Set([0, 1]));
    expect(v.get(807)!.total).toBe(2);
    expect(v.get(-1)!.total).toBe(2);
  });
  it("un groupe qui se chevauche en chaîne partage le même nombre de colonnes ; la colonne libérée est réutilisée", () => {
    const v = voiesPlanning([
      { id: 1, debut: 600, fin: 690 },  // serrure 10:00–11:30
      { id: 2, debut: 660, fin: 700 },  // Publier 11:00
      { id: 3, debut: 690, fin: 720 },  // Rédiger 11:30
      { id: 4, debut: 900, fin: 930 },  // seul, plus tard
    ]);
    expect(v.get(1)).toEqual({ voie: 0, total: 2 });
    expect(v.get(2)).toEqual({ voie: 1, total: 2 });
    expect(v.get(3)).toEqual({ voie: 0, total: 2 });
    expect(v.get(4)).toEqual({ voie: 0, total: 1 });
  });
});
