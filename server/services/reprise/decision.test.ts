import { describe, it, expect } from "vitest";
import { normaliserDecisions, promptReprise, type SortieReprise } from "./decision";

const T = (id: number, extra: Record<string, unknown> = {}) => ({ id, title: `Tâche ${id}`, estimatedDuration: 30, priority: 2, ...extra });
const d = (id: number, extra: Partial<SortieReprise["taches"][number]> = {}): SortieReprise["taches"][number] => ({
  id, action: "garder", titre: null, description: null, duree: null, sousTaches: [], fusionAvec: [], priorite: 2, auPlusTard: null, raison: "", ...extra,
});
const AUJ = "2026-10-26";

describe("normaliserDecisions", () => {
  it("sans avis de Naya, tout est gardé tel quel", () => {
    const r = normaliserDecisions([T(1), T(2, { priority: 1 })], null, AUJ);
    expect(r.map((x) => [x.id, x.action, x.priorite])).toEqual([[1, "garder", 2], [2, "garder", 1]]);
  });

  it("une tâche oubliée par le modèle est gardée ; un id inventé est ignoré", () => {
    const r = normaliserDecisions([T(1), T(2)], { taches: [d(1, { action: "abandonner", raison: "Dépassée." }), d(99, { action: "abandonner" })] }, AUJ);
    expect(r.map((x) => [x.id, x.action])).toEqual([[1, "abandonner"], [2, "garder"]]);
  });

  it("découper exige au moins deux sous-tâches, bornées à cinq", () => {
    const une = normaliserDecisions([T(1)], { taches: [d(1, { action: "decouper", sousTaches: [{ titre: "A", description: null, duree: 20 }] })] }, AUJ);
    expect(une[0].action).toBe("garder");
    const six = Array.from({ length: 6 }, (_, i) => ({ titre: `S${i}`, description: null, duree: 999 }));
    const r = normaliserDecisions([T(1)], { taches: [d(1, { action: "decouper", sousTaches: six })] }, AUJ);
    expect(r[0].action).toBe("decouper");
    expect(r[0].sousTaches).toHaveLength(5);
    expect(r[0].sousTaches[0].duree).toBe(240);
  });

  it("fusionner absorbe les autres tâches de la liste, qui n'ont plus d'entrée propre", () => {
    const r = normaliserDecisions([T(1), T(2), T(3)], { taches: [d(1, { action: "fusionner", titre: "Une seule", fusionAvec: [2, 42] }), d(2, { action: "abandonner" })] }, AUJ);
    expect(r.map((x) => x.id)).toEqual([1, 3]);
    expect(r[0]).toMatchObject({ action: "fusionner", titre: "Une seule", absorbe: [2] });
  });

  it("fusionner sans rien à absorber devient une reformulation", () => {
    const r = normaliserDecisions([T(1)], { taches: [d(1, { action: "fusionner", titre: "Nouveau titre", fusionAvec: [7] })] }, AUJ);
    expect(r[0]).toMatchObject({ action: "reformuler", titre: "Nouveau titre", absorbe: [] });
  });

  it("reformuler sans rien changer, c'est garder", () => {
    expect(normaliserDecisions([T(1)], { taches: [d(1, { action: "reformuler" })] }, AUJ)[0].action).toBe("garder");
  });

  it("date « au plus tard » : invalide → null, passée → aujourd'hui", () => {
    const r = normaliserDecisions([T(1), T(2)], { taches: [d(1, { auPlusTard: "bientôt" }), d(2, { auPlusTard: "2026-10-01" })] }, AUJ);
    expect(r[0].auPlusTard).toBeNull();
    expect(r[1].auPlusTard).toBe(AUJ);
  });
});

describe("promptReprise", () => {
  it("dit au modèle les reports, l'objectif et la place des jours qui viennent", () => {
    const p = promptReprise({
      aujourdhui: AUJ, contexte: "Objectif : 10 clients d'ici décembre",
      taches: [{ ...T(5), learnedAdjustmentCount: 4, projet: "Agence JMD", objectif: "10 clients" }],
      charge: [{ jour: "2026-10-27", minutesLibres: 90, taches: 6 }],
      faitesRecemment: ["Appeler Léa"],
    });
    expect(p).toContain("#5 Tâche 5");
    expect(p).toContain("reportée 4 fois");
    expect(p).toContain("objectif : 10 clients");
    expect(p).toContain("90 min libres");
    expect(p).toContain("- Appeler Léa");
  });
});
