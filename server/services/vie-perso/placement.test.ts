import { describe, it, expect } from "vitest";
import { fenetreDuJour, placer, tachesDuPlan, placerActivite, jourAvant, placerDemandes } from "./placement";
import { PROFIL_DEFAUT, type PlanRepas } from "@shared/vie-perso";

const P = PROFIL_DEFAUT;
const vide = () => new Map<string, { start: number; end: number }[]>();

describe("fenetreDuJour", () => {
  it("soir en semaine, journée le week-end", () => {
    expect(fenetreDuJour("2026-11-25", P)).toEqual({ start: 18 * 60 + 30, end: 22 * 60 });
    expect(fenetreDuJour("2026-11-28", P)).toEqual({ start: 9 * 60, end: 20 * 60 });
  });
});

describe("jourAvant", () => {
  it("le dernier jour donné avant le lundi", () => {
    expect(jourAvant("2026-11-30", 0)).toBe("2026-11-29"); // dimanche
    expect(jourAvant("2026-11-30", 6)).toBe("2026-11-28"); // samedi
    expect(jourAvant("2026-11-30", 1)).toBe("2026-11-23"); // lundi d'avant
  });
});

describe("placer", () => {
  it("heure demandée libre : gardée", () => {
    expect(placer({ jour: "2026-11-28", heure: "10:00", duree: 60, fenetre: "weekend" }, vide(), P, { jour: "2026-11-23", min: 0 }))
      .toEqual({ jour: "2026-11-28", heure: "10:00" });
  });
  it("heure demandée occupée : glisse au premier créneau libre de la fenêtre du même jour", () => {
    const occ = vide(); occ.set("2026-11-28", [{ start: 600, end: 690 }]);
    expect(placer({ jour: "2026-11-28", heure: "10:00", duree: 60, fenetre: "weekend" }, occ, P, { jour: "2026-11-23", min: 0 }))
      .toEqual({ jour: "2026-11-28", heure: "11:30" });
  });
  it("heure demandée sans aucune place : gardée (le chevauchement se voit)", () => {
    const occ = vide(); occ.set("2026-11-25", [{ start: 0, end: 24 * 60 }]);
    expect(placer({ jour: "2026-11-25", heure: "19:05", duree: 25, fenetre: "soir" }, occ, P, { jour: "2026-11-23", min: 0 }))
      .toEqual({ jour: "2026-11-25", heure: "19:05" });
  });
  it("sans heure : premier soir libre à partir de depuis", () => {
    const occ = vide(); occ.set("2026-11-24", [{ start: 18 * 60, end: 22 * 60 }]);
    expect(placer({ duree: 60, fenetre: "soir" }, occ, P, { jour: "2026-11-24", min: 0 }))
      .toEqual({ jour: "2026-11-25", heure: "18:30" });
  });
  it("sans heure, week-end : saute les soirs de semaine", () => {
    expect(placer({ duree: 120, fenetre: "weekend" }, vide(), P, { jour: "2026-11-24", min: 0 }))
      .toEqual({ jour: "2026-11-28", heure: "09:00" });
  });
  it("respecte l'heure de départ (pas dans le passé)", () => {
    expect(placer({ duree: 30, fenetre: "soir" }, vide(), P, { jour: "2026-11-24", min: 20 * 60 + 10 }))
      .toEqual({ jour: "2026-11-24", heure: "20:10" });
  });
  it("rien avant la date limite : null", () => {
    const occ = vide();
    for (const j of ["2026-11-24", "2026-11-25"]) occ.set(j, [{ start: 0, end: 24 * 60 }]);
    expect(placer({ duree: 30, fenetre: "soir", avant: "2026-11-25" }, occ, P, { jour: "2026-11-24", min: 0 })).toBeNull();
  });
});

const repas = (titre: string, prep: number) => ({ titre, detail: `${titre} détail`, kcal: 600, proteines: 40, lipides: 20, glucides: 50, variantes: [{ membre: "Milan", texte: "+ pain" }], preparationMin: prep });
const SEMAINE = "2026-11-30";
const plan: PlanRepas = {
  jours: ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"].map((date, i) => ({
    date, dejeuner: repas(`Déj ${i}`, i === 5 ? 20 : 5), diner: repas(`Dîner ${i}`, i === 1 ? 0 : 25), dessert: repas(`Dessert ${i}`, 0),
  })),
  batch: { dureeMin: 150, etapes: [{ appareil: "Thermomix", action: "Cuire le riz" }, { appareil: "Four", action: "Rôtir les patates douces" }] },
  courses: [
    { article: "Saumon", quantite: "x4", magasin: "Picard", rayon: "Surgelés", pour: "tous" },
    { article: "Yaourt grec", quantite: "2 pots", magasin: "Aldi", rayon: "Frais", pour: "Jeanne" },
  ],
  regles: [], snacks: [],
};

describe("tachesDuPlan", () => {
  const d = tachesDuPlan(plan, P, SEMAINE);
  it("courses le samedi d'avant, une seule tâche, magasins dans la description", () => {
    const c = d.find((x) => x.cle === "courses")!;
    expect(c).toMatchObject({ jour: "2026-11-28", heure: "10:00", duree: 60, fenetre: "weekend" });
    expect(c.titre).toBe("Courses : Picard, Aldi");
    expect(c.description).toContain("Picard");
    expect(c.description).toContain("Saumon (x4)");
  });
  it("batch le dimanche d'avant, durée bornée par le réglage", () => {
    const b = d.find((x) => x.cle === "batch")!;
    expect(b).toMatchObject({ jour: "2026-11-29", heure: "10:00", duree: 120 });
    expect(b.description).toContain("1. Thermomix : Cuire le riz");
  });
  it("préparer le dîner finit à l'heure du dîner ; rien quand la préparation est nulle", () => {
    const lundi = d.find((x) => x.cle === "diner:2026-11-30")!;
    expect(lundi).toMatchObject({ jour: "2026-11-30", heure: "19:05", duree: 25, fenetre: "soir" });
    expect(lundi.titre).toBe("Préparer le dîner : Dîner 0");
    expect(lundi.description).toContain("Milan : + pain");
    expect(d.find((x) => x.cle === "diner:2026-12-01")).toBeUndefined();
  });
  it("déjeuner : seulement le week-end", () => {
    expect(d.find((x) => x.cle === "dejeuner:2026-11-30")).toBeUndefined();
    expect(d.find((x) => x.cle === "dejeuner:2026-12-05")).toMatchObject({ heure: "11:40", duree: 20 });
  });
  it("courses le même jour que le batch si le réglage les met après", () => {
    const d2 = tachesDuPlan(plan, { ...P, coursesJour: 1, batchJour: 0 }, SEMAINE);
    expect(d2.find((x) => x.cle === "courses")!.jour <= d2.find((x) => x.cle === "batch")!.jour).toBe(true);
  });
});

describe("placerActivite", () => {
  const contenu = {
    achats: [{ article: "Feutrine", quantite: "3 plaques", ou: "Mercerie" }],
    etapes: [
      { titre: "Dessiner les lettres", dureeMin: 45, ensemble: false },
      { titre: "Coudre avec Lou", dureeMin: 120, ensemble: true },
    ],
  };
  it("achats d'abord, puis étapes dans l'ordre ; ensemble → week-end", () => {
    const r = placerActivite({ titre: "Lettres en feutrine", contenu, quand: "soir", dateCible: null }, vide(), P, { jour: "2026-11-24", min: 0 });
    expect(r.nonPlacees).toEqual([]);
    expect(r.taches.map((t) => [t.titre, t.jour, t.heure])).toEqual([
      ["Acheter le matériel : Lettres en feutrine", "2026-11-24", "18:30"],
      ["Lettres en feutrine : Dessiner les lettres", "2026-11-24", "19:15"],
      ["Lettres en feutrine : Coudre avec Lou", "2026-11-28", "09:00"],
    ]);
    expect(r.taches[0].description).toContain("Feutrine (3 plaques), Mercerie");
  });
  it("sans achats : pas de tâche d'achat", () => {
    const r = placerActivite({ titre: "Promenade", contenu: { achats: [], etapes: [{ titre: "Marcher", dureeMin: 60, ensemble: false }] }, quand: "indifferent", dateCible: null }, vide(), P, { jour: "2026-11-24", min: 0 });
    expect(r.taches).toHaveLength(1);
  });
  it("étape impossible avant la date cible : signalée, pas placée", () => {
    const occ = vide(); occ.set("2026-11-24", [{ start: 0, end: 24 * 60 }]);
    const r = placerActivite({ titre: "X", contenu: { achats: [], etapes: [{ titre: "Y", dureeMin: 60, ensemble: false }] }, quand: "soir", dateCible: "2026-11-24" }, occ, P, { jour: "2026-11-24", min: 0 });
    expect(r.taches).toEqual([]);
    expect(r.nonPlacees).toEqual(["Y"]);
  });
});

describe("placerDemandes", () => {
  it("ignore ce qui est déjà passé, et deux demandes au même moment ne se chevauchent pas", () => {
    const d = [
      { cle: "a", titre: "A", description: "", jour: "2026-11-28", heure: "10:00", duree: 60, fenetre: "weekend" as const },
      { cle: "b", titre: "B", description: "", jour: "2026-11-28", heure: "10:00", duree: 30, fenetre: "weekend" as const },
      { cle: "c", titre: "C", description: "", jour: "2026-11-27", heure: "19:00", duree: 30, fenetre: "soir" as const },
    ];
    const r = placerDemandes(d, vide(), P, { jour: "2026-11-28", min: 0 });
    expect(r.map((x) => [x.cle, x.heure])).toEqual([["a", "10:00"], ["b", "11:00"]]);
  });
});
