import { describe, it, expect } from "vitest";
import { donneesRapport, moisDe } from "./donnees";

const SEPT = "2026-09";
const base = {
  mesures: [
    { mois: "2026-09", ca: 12000, nouveauxClients: 20, commandes: 100, caNouveaux: null, coutsVariables: null, depenses: { paid_social: 2000 } },
    { mois: "2026-08", ca: 10000, nouveauxClients: 16, commandes: 90, caNouveaux: null, coutsVariables: null, depenses: { paid_social: 2000 } },
  ],
  contenus: [
    { id: 1, title: "Coulisses", platform: "instagram", publishedAt: "2026-09-10T08:00:00Z" },
    { id: 2, title: "Sélection", platform: "Instagram", publishedAt: "2026-09-20T08:00:00Z" },
    { id: 3, title: "Interview", platform: "linkedin", publishedAt: "2026-09-25T08:00:00Z" },
    { id: 4, title: "Juste après", platform: "linkedin", publishedAt: "2026-10-01T08:00:00Z" },
    { id: 5, title: "Brouillon", platform: "linkedin", publishedAt: null },
    { id: 6, title: "Quatrième", platform: "linkedin", publishedAt: "2026-09-26T08:00:00Z" },
  ],
  scores: [{ contentId: 1, score: 4.2 }, { contentId: 2, score: 2.1 }, { contentId: 3, score: 4.8 }, { contentId: 6, score: 3 }],
  messages: [
    { leadId: 1, sentAt: "2026-09-03T10:00:00Z", responseReceived: true, responseDate: "2026-09-05T10:00:00Z" },
    { leadId: 1, sentAt: "2026-09-10T10:00:00Z", responseReceived: true, responseDate: "2026-09-12T10:00:00Z" },
    { leadId: 2, sentAt: "2026-08-29T10:00:00Z", responseReceived: true, responseDate: "2026-08-30T10:00:00Z" },
    { leadId: 3, sentAt: null, responseReceived: false, responseDate: null },
  ],
  constats: [
    { titre: "Un concurrent baisse ses prix", createdAt: "2026-09-12T10:00:00Z", statut: "nouveau" },
    { titre: "Ancien", createdAt: "2026-08-12T10:00:00Z", statut: "nouveau" },
    { titre: "Écarté", createdAt: "2026-09-13T10:00:00Z", statut: "ecarte" },
  ],
};

describe("moisDe — le mois d'un instant, à Paris", () => {
  it("le 1er octobre à 0 h 30 à Paris est en octobre, même si c'est encore septembre en UTC", () => {
    expect(moisDe("2026-09-30T22:30:00Z")).toBe("2026-10");
    expect(moisDe("2026-09-30T21:30:00Z")).toBe("2026-09");
  });
});

describe("donneesRapport", () => {
  const d = donneesRapport(base as any, SEPT);
  it("chiffres du mois avec l'évolution sur le mois précédent — seulement les indicateurs montrés au client", () => {
    expect(Object.keys(d.chiffres!.indicateurs).sort()).toEqual(["ca", "cac", "depense_totale", "mer", "nouveaux_clients", "panier_moyen"]);
    expect(d.chiffres?.indicateurs.ca).toBe(12000);
    expect(d.chiffres?.indicateurs.mer).toBe(6);
    expect(d.chiffres?.evolutions.ca).toBeCloseTo(0.2);
  });
  it("contenus publiés DANS le mois, par plateforme, et les 3 meilleurs par score", () => {
    expect(d.contenus?.total).toBe(4);
    expect(d.contenus?.parPlateforme).toEqual({ instagram: 2, linkedin: 2 });
    expect(d.contenus?.meilleurs.map((c) => c.titre)).toEqual(["Interview", "Coulisses", "Quatrième"]);
    // Le score de réception est interne : il classe, il ne sort pas.
    expect(JSON.stringify(d.contenus)).not.toContain("score");
  });
  it("prospection : messages envoyés et prospects qui ont répondu DANS le mois", () => {
    expect(d.prospection).toEqual({ envoyes: 2, reponses: 1 });
  });
  it("un mois sans aucune activité reste vide, même avec des prospects en discussion depuis longtemps", () => {
    const v = donneesRapport({ ...base, mesures: [], contenus: [], constats: [] } as any, "2026-07");
    expect(v.vide).toBe(true);
  });
  it("veille : constats du mois, jamais les écartés", () => {
    expect(d.veille).toEqual(["Un concurrent baisse ses prix"]);
  });
  it("rien inventé : une rubrique sans donnée est absente, et `vide` le dit", () => {
    const v = donneesRapport({ mesures: [], contenus: [], scores: [], messages: [], constats: [] } as any, SEPT);
    expect(v).toEqual({ mois: SEPT, chiffres: null, contenus: null, prospection: null, veille: null, vide: true });
    expect(d.vide).toBe(false);
  });
});

import { bornesMois } from "./donnees";
describe("bornesMois — un mois à l'heure de Paris", () => {
  it("septembre 2026 : du 1er à 0 h (UTC+2) au 1er octobre à 0 h", () => {
    const b = bornesMois("2026-09");
    expect(b.debut.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(b.fin.toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
  it("traverse le passage à l'heure d'hiver (octobre → novembre)", () => {
    const b = bornesMois("2026-10");
    expect(b.debut.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(b.fin.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
  it("décembre → janvier", () => {
    expect(bornesMois("2026-12").fin.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });
});
