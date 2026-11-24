import { describe, it, expect } from "vitest";
import {
  engagementDuPost, heuresDuJour, jourHeureLocal, matriceDonnees, matriceGenerique, meilleuresHeures, meilleursCreneaux,
  melanger, normaliser, poidsDonnees, reseauMeilleuresHeures, SEUIL_DONNEES, SEUIL_POSTS, type Matrice,
} from "./meilleures-heures";

const vide = (): Matrice => Array.from({ length: 7 }, () => new Array(24).fill(0));
const meilleure = (m: Matrice) => {
  let best = { jour: 0, heure: 0, v: -1 };
  m.forEach((l, jour) => l.forEach((v, heure) => { if (v > best.v) best = { jour, heure, v }; }));
  return best;
};

describe("normaliser", () => {
  it("le maximum vaut 1, le reste en proportion ; une grille vide reste à 0", () => {
    const m = vide(); m[2][9] = 4; m[0][0] = 1;
    const n = normaliser(m);
    expect(n[2][9]).toBe(1);
    expect(n[0][0]).toBe(0.25);
    expect(normaliser(vide()).flat().every((v) => v === 0)).toBe(true);
  });
});

describe("grilles génériques", () => {
  it("7 × 24, entre 0 et 1, un 1 au moins", () => {
    for (const r of ["instagram", "linkedin", "facebook", "tiktok", "pinterest"]) {
      const m = matriceGenerique(r);
      expect(m).toHaveLength(7);
      expect(m.every((l) => l.length === 24)).toBe(true);
      expect(m.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
      expect(Math.max(...m.flat())).toBe(1);
    }
  });

  it("LinkedIn : le meilleur créneau est un mardi ou un mercredi à 9 h ; le week-end est bas", () => {
    const m = matriceGenerique("LinkedIn");
    const b = meilleure(m);
    expect([1, 2]).toContain(b.jour);
    expect(b.heure).toBe(9);
    expect(m[5][9]).toBeLessThan(0.4);
  });

  it("Instagram : midi et le soir devant le matin", () => {
    const m = matriceGenerique("instagram");
    expect(m[2][12]).toBeGreaterThan(m[2][8]);
    expect(m[2][19]).toBeGreaterThan(m[2][15]);
  });

  it("réseau reconnu quelle que soit la casse", () => {
    expect(reseauMeilleuresHeures(" TikTok ")).toBe("tiktok");
    expect(reseauMeilleuresHeures("x")).toBeNull();
  });
});

describe("données de la marque", () => {
  it("taux d'engagement : interactions / portée ; sans portée, rien", () => {
    expect(engagementDuPost({ publieLe: new Date(), saves: 5, shares: 3, comments: 2, reach: 100 })).toBe(0.1);
    expect(engagementDuPost({ publieLe: new Date(), saves: 5, reach: 0 })).toBeNull();
    expect(engagementDuPost({ publieLe: new Date(), saves: 5, reach: null })).toBeNull();
  });

  it("moyenne par jour et heure de Paris (heure d'hiver et d'été)", () => {
    const { moyennes, n } = matriceDonnees([
      // Mardi 13 janvier 2026, 09:30 à Paris = 08:30 UTC (hiver).
      { publieLe: "2026-01-13T08:30:00Z", saves: 10, reach: 100 },
      { publieLe: "2026-01-13T08:10:00Z", saves: 30, reach: 100 },
      // Mardi 14 juillet 2026, 09:30 à Paris = 07:30 UTC (été).
      { publieLe: "2026-07-14T07:30:00Z", saves: 20, reach: 100 },
      { publieLe: "2026-07-14T07:30:00Z", saves: 20, reach: 0 },
    ]);
    expect(n).toBe(3);
    expect(moyennes[1][9]).toBeCloseTo(0.2);
    expect(moyennes[1][10]).toBeNull();
  });

  it("seuils : générique sous 15 posts, mixte ensuite, données à partir de 60", () => {
    expect(poidsDonnees(SEUIL_POSTS - 1)).toEqual({ poids: 0, source: "generique" });
    expect(poidsDonnees(SEUIL_POSTS).source).toBe("mixte");
    expect(poidsDonnees(SEUIL_DONNEES).source).toBe("donnees");
  });

  it("sous le seuil, la grille est la générique ; au-delà, le créneau fort de la marque monte, le faible descend", () => {
    const g = matriceGenerique("linkedin");
    // Moitié le dimanche 20 h (très engageants), moitié le mardi 9 h (peu engageants).
    const posts = (k: number) => Array.from({ length: k }, (_, i) => i % 2 === 0
      ? { publieLe: "2026-03-01T19:00:00Z", saves: 50, reach: 100 }
      : { publieLe: "2026-03-03T08:00:00Z", saves: 5, reach: 100 });
    const sous = melanger(g, matriceDonnees(posts(SEUIL_POSTS - 1)));
    expect(sous.source).toBe("generique");
    expect(sous.matrice).toEqual(g);
    const sur = meilleuresHeures("linkedin", posts(SEUIL_POSTS));
    expect(sur.source).toBe("mixte");
    expect(sur.n).toBe(SEUIL_POSTS);
    expect(sur.matrice[6][20]).toBeGreaterThan(g[6][20]);
    expect(sur.matrice[1][9]).toBeLessThan(sur.matrice[2][9]);
    expect(Math.max(...sur.matrice.flat())).toBe(1);
    // Une cellule sans post de la marque garde l'ordre générique.
    expect(sur.matrice[3][9]).toBeGreaterThan(sur.matrice[3][15]);
  });

  it("tous les posts dans un seul créneau : rien à comparer, la grille ne bouge pas", () => {
    const g = matriceGenerique("instagram");
    const posts = Array.from({ length: 30 }, () => ({ publieLe: "2026-03-03T15:00:00Z", saves: 50, reach: 100 }));
    expect(meilleuresHeures("instagram", posts).matrice).toEqual(g);
  });
});

describe("meilleursCreneaux", () => {
  it("trois créneaux, un par jour, dans les 7 jours, après la marge, triés par date", () => {
    const m = matriceGenerique("linkedin");
    const maintenant = new Date("2026-11-23T10:00:00Z"); // lundi 11 h à Paris
    const c = meilleursCreneaux(m, maintenant);
    expect(c).toHaveLength(3);
    const jours = c.map((x) => jourHeureLocal(x.instant).date);
    expect(new Set(jours).size).toBe(3);
    for (const x of c) {
      expect(x.instant.getTime()).toBeGreaterThan(maintenant.getTime());
      expect(x.instant.getTime()).toBeLessThan(maintenant.getTime() + 7 * 86_400_000);
      expect(jourHeureLocal(x.instant).heure).toBe(x.heure);
    }
    expect(c.map((x) => x.instant.getTime())).toEqual([...c.map((x) => x.instant.getTime())].sort((a, b) => a - b));
    // Mardi, mercredi, jeudi à 9 h de Paris (8 h UTC en hiver).
    expect(c.map((x) => x.instant.toISOString())).toEqual(["2026-11-24T08:00:00.000Z", "2026-11-25T08:00:00.000Z", "2026-11-26T08:00:00.000Z"]);
  });

  it("heure d'été : 9 h de Paris = 7 h UTC ; l'heure sautée du 29 mars n'est jamais proposée", () => {
    const m = vide();
    m[6][2] = 1; // dimanche 2 h : n'existe pas le 29 mars 2026
    m[0][9] = 0.5; // lundi 9 h
    const c = meilleursCreneaux(m, new Date("2026-03-28T12:00:00Z"), { n: 2, jours: 3 });
    expect(c.every((x) => !(x.jour === 6 && x.heure === 2))).toBe(true);
    expect(c.map((x) => x.instant.toISOString())).toContain("2026-03-30T07:00:00.000Z");
  });

  it("passage à l'heure d'hiver : un créneau par jour malgré l'heure répétée", () => {
    const m = vide(); m[6][2] = 1;
    const c = meilleursCreneaux(m, new Date("2026-10-24T12:00:00Z"), { n: 3, jours: 2 });
    expect(new Set(c.map((x) => jourHeureLocal(x.instant).date)).size).toBe(c.length);
  });
});

describe("heuresDuJour", () => {
  it("dans la plage de travail, de la meilleure à la moins bonne, espacées de 2 h", () => {
    const m = matriceGenerique("linkedin");
    const h = heuresDuJour(m, 1, { debut: 9, fin: 18 });
    expect(h[0]).toBe(9);
    expect(h[1]).toBe(12);
    expect(h.every((x) => x >= 9 && x < 18)).toBe(true);
    for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) expect(Math.abs(h[i] - h[j])).toBeGreaterThanOrEqual(2);
  });

  it("plage vide : l'heure de début", () => {
    expect(heuresDuJour(matriceGenerique("instagram"), 0, { debut: 10, fin: 10 })).toEqual([10]);
  });
});
