// Chantiers sans mouvement (spec, points 2 et 5) : un chantier sans mouvement depuis 15 jours est
// signalé le matin avec son prochain pas ; un rendez-vous de l'agenda qui le cite compte comme
// mouvement. Toutes les sources sont injectées : aucun test ne touche une vraie base ni l'agenda.
import { describe, it, expect, vi } from "vitest";
import type { CarteFil, EtapeCarte, ObjectifCarte } from "./carte";
import {
  chantiersDe, evenementCite, chantiersSansMouvement, collecterMouvements, chantiersBloquesEnCache, viderCacheChantiers, requeteTachesFaites,
  type Chantier, type SourcesMouvements,
} from "./mouvements";

const JOUR = 24 * 3600_000;
const MAINTENANT = new Date("2026-11-12T08:00:00Z");
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * JOUR);
const ANCIEN = ilYA(90);

const etape = (id: number, objectifId: number | null, projetId: number, titre: string, statut = "active", ordre = 0): EtapeCarte => ({
  id, objectifId, projetId, titre, pourquoi: null, statut, ordre, faites: 0, prevues: 0, debut: ANCIEN,
});
const objectif = (id: number, projetId: number, titre: string, etapes: EtapeCarte[]): ObjectifCarte => ({
  id, projetId, titre, successMode: "revenue", goalType: "revenue", cible: null, dueDate: null, etapes, creeLe: ANCIEN,
});

describe("evenementCite", () => {
  it("« Point Garance » cite le chantier « Garance » ; « Garantie » ne le cite pas", () => {
    expect(evenementCite("Point Garance", ["Garance"])).toBe(true);
    expect(evenementCite("Garantie décennale", ["Garance"])).toBe(false);
  });

  it("sans accents ni casse, sur des mots entiers, noms de moins de 3 lettres ignorés", () => {
    expect(evenementCite("déj avec GARANCE", ["garance"])).toBe(true);
    expect(evenementCite("Visio Atelier Méjean", ["atelier mejean"])).toBe(true);
    expect(evenementCite("Appel l'Épicerie fine", ["L'épicerie"])).toBe(true);
    expect(evenementCite("RDV JM", ["JM"])).toBe(false);
    expect(evenementCite("Point Garance", ["", "  "])).toBe(false);
  });

  it("noms d'un mot de moins de 4 lettres et noms génériques ignorés : « Naya » seul ne cite rien", () => {
    expect(evenementCite("Point Naya", ["Naya"])).toBe(false);
    expect(evenementCite("Visio agence", ["Agence"])).toBe(false);
    expect(evenementCite("Café Lou", ["Lou"])).toBe(false);
    expect(evenementCite("Point Agence JMD", ["Agence JMD"])).toBe(true);
    expect(evenementCite("Déj Lune", ["Lune"])).toBe(true);
  });
});

describe("chantiersDe", () => {
  const carte: CarteFil = {
    objectifs: [
      objectif(1, 10, "3 clients d'ici fin décembre", [etape(100, 1, 10, "Offre", "completed", 0), etape(101, 1, 10, "Rendez-vous", "active", 1)]),
      objectif(2, 10, "Visibilité", [etape(200, 2, 10, "Plus tard", "locked")]),
    ],
    chainesSansObjectif: new Map([[30, [etape(300, null, 30, "Livrer le site")]]]),
    depuis: ANCIEN,
  };
  const projets = [
    { id: 10, name: "Agence JMD", clientName: null, createdAt: ANCIEN },
    { id: 20, name: "Garance", clientName: "Restaurant Garance", createdAt: ANCIEN },
    { id: 30, name: "Tour de Main", clientName: null, createdAt: ANCIEN },
  ];

  it("une étape active, sinon un objectif actif sans étape, sinon un projet actif sans objectif", () => {
    const ch = chantiersDe(carte, projets, [{ parentProjectId: 20, name: "Brasserie Garance" }],
      [{ projectId: 10, name: "Marie Dupont", company: "Studio Lune" }]);
    expect(ch.map((c) => c.cle).sort()).toEqual(["etape:101", "etape:300", "objectif:2", "projet:20"]);
    const r = ch.find((c) => c.cle === "etape:101")!;
    expect(r).toMatchObject({ projetId: 10, objectifId: 1, etapeId: 101 });
    expect(r.noms).toEqual(expect.arrayContaining(["Agence JMD", "Marie Dupont", "Studio Lune"]));
    expect(ch.find((c) => c.cle === "projet:20")!.noms).toEqual(expect.arrayContaining(["Garance", "Restaurant Garance", "Brasserie Garance"]));
  });

  it("un projet hors liste des projets actifs ne donne aucun chantier", () => {
    const ch = chantiersDe(carte, [projets[1]], [], []);
    expect(ch.map((c) => c.cle)).toEqual(["projet:20"]);
  });

  it("prochain pas : la prochaine tâche non faite de l'étape, sinon le titre de l'étape", () => {
    const ch = chantiersDe(carte, projets, [], [], [
      { id: 7, title: "Relancer Marie", milestoneId: 101, goalId: 1, projectId: 10, scheduledDate: "2026-11-20" },
      { id: 6, title: "Appeler Paul", milestoneId: 101, goalId: 1, projectId: 10, scheduledDate: "2026-11-14" },
    ]);
    expect(ch.find((c) => c.cle === "etape:101")!.prochainPas).toBe("Appeler Paul");
    expect(ch.find((c) => c.cle === "etape:300")!.prochainPas).toBe("Livrer le site");
  });
});

describe("chantiersSansMouvement", () => {
  const chantier: Chantier = { cle: "etape:1", libelle: "Rendez-vous (Agence JMD)", projetId: 10, objectifId: 1, etapeId: 1, noms: ["Agence JMD"], prochainPas: "Appeler Paul", debut: ANCIEN };

  it("un chantier à 14 jours n'est pas signalé, à 15 il l'est", () => {
    expect(chantiersSansMouvement([chantier], [{ cle: "etape:1", at: ilYA(14) }], MAINTENANT)).toEqual([]);
    expect(chantiersSansMouvement([chantier], [{ cle: "etape:1", at: ilYA(15) }], MAINTENANT))
      .toEqual([{ libelle: "Rendez-vous (Agence JMD)", joursSansMouvement: 15, prochainPas: "Appeler Paul" }]);
  });

  it("un rendez-vous il y a 3 jours remet le compteur à 3", () => {
    const mouvements = [{ cle: "etape:1", at: ilYA(40) }, { cle: "etape:1", at: ilYA(3) }];
    expect(chantiersSansMouvement([chantier], mouvements, MAINTENANT, 0)[0].joursSansMouvement).toBe(3);
    expect(chantiersSansMouvement([chantier], mouvements, MAINTENANT)).toEqual([]);
  });

  it("un chantier créé il y a moins de 15 jours n'est pas signalé ; les mouvements d'un autre chantier ou futurs ne comptent pas", () => {
    expect(chantiersSansMouvement([{ ...chantier, debut: ilYA(10) }], [], MAINTENANT)).toEqual([]);
    const r = chantiersSansMouvement([chantier], [{ cle: "etape:2", at: ilYA(1) }, { cle: "etape:1", at: new Date(MAINTENANT.getTime() + JOUR) }], MAINTENANT, 15, ilYA(60));
    expect(r).toEqual([{ libelle: "Rendez-vous (Agence JMD)", joursSansMouvement: 60, prochainPas: "Appeler Paul" }]);
  });
});

describe("collecterMouvements", () => {
  const chantiers: Chantier[] = [
    { cle: "etape:101", libelle: "Rendez-vous", projetId: 10, objectifId: 1, etapeId: 101, noms: ["Agence JMD"], prochainPas: "x" },
    { cle: "objectif:2", libelle: "Visibilité", projetId: 10, objectifId: 2, noms: ["Agence JMD"], prochainPas: "x" },
    { cle: "projet:20", libelle: "Garance", projetId: 20, noms: ["Garance"], prochainPas: "x" },
  ];
  const vide = async () => [];
  const sources = (over: Partial<SourcesMouvements> = {}): SourcesMouvements => ({
    tachesFaites: vi.fn(vide), tachesCreees: vi.fn(vide), contenusPublies: vi.fn(vide),
    prospectsContactes: vi.fn(vide), reponsesRecues: vi.fn(vide), agenda: vi.fn(vide), ...over,
  });

  it("chaque source est rattachée au chantier par étape, objectif ou projet", async () => {
    const s = sources({
      tachesFaites: vi.fn(async () => [{ etapeId: 101, objectifId: 1, projetId: 10, at: ilYA(2) }]),
      tachesCreees: vi.fn(async () => [{ objectifId: 2, projetId: 10, at: ilYA(4) }]),
      prospectsContactes: vi.fn(async () => [{ projetId: 20, at: ilYA(5) }]),
    });
    const m = await collecterMouvements("u1", chantiers, ilYA(60), s);
    expect(m).toEqual(expect.arrayContaining([
      { cle: "etape:101", at: ilYA(2) }, { cle: "objectif:2", at: ilYA(4) }, { cle: "projet:20", at: ilYA(5) },
    ]));
    expect(m).toHaveLength(3);
    expect(s.tachesFaites).toHaveBeenCalledWith("u1", ilYA(60));
  });

  it("un mouvement qui ne connaît que son projet ne compte pas quand le projet a deux chantiers", async () => {
    const s = sources({
      tachesFaites: vi.fn(async () => [{ projetId: 10, at: ilYA(1) }]),
      contenusPublies: vi.fn(async () => [{ projetId: 10, at: ilYA(1) }]),
    });
    expect(await collecterMouvements("u1", chantiers, ilYA(60), s)).toEqual([]);
  });

  it("… et compte quand le projet n'a qu'un chantier", async () => {
    const s = sources({ tachesFaites: vi.fn(async () => [{ projetId: 10, at: ilYA(1) }]) });
    expect(await collecterMouvements("u1", [chantiers[0]], ilYA(60), s)).toEqual([{ cle: "etape:101", at: ilYA(1) }]);
  });

  it("une tâche d'étape ne compte que pour son étape, ou l'objectif sans étape en cours ; jamais un objectif voisin", async () => {
    const s = sources({
      tachesFaites: vi.fn(async () => [
        { etapeId: 999, objectifId: 1, projetId: 10, at: ilYA(2) }, // autre étape de l'objectif 1
        { etapeId: 101, objectifId: null, projetId: 10, at: ilYA(3) }, // objectif inconnu
        { etapeId: 250, objectifId: 2, projetId: 10, at: ilYA(4) }, // étape (non en cours) de l'objectif 2
      ]),
    });
    expect(await collecterMouvements("u1", chantiers, ilYA(60), s)).toEqual([
      { cle: "etape:101", at: ilYA(3) }, { cle: "objectif:2", at: ilYA(4) },
    ]);
  });

  it("une tâche de rituel faite ne compte jamais (filtrée dans la requête)", () => {
    const { sql } = requeteTachesFaites("u1", ilYA(60)).toSQL();
    expect(sql).toMatch(/"ritual_id" is null/);
    expect(sql).toMatch(/"type" <> /);
  });

  it("l'agenda n'est lu que sur les 15 derniers jours, jusqu'à maintenant", async () => {
    const s = sources();
    await collecterMouvements("u1", chantiers, ilYA(60), s, MAINTENANT);
    expect(s.agenda).toHaveBeenCalledWith("u1", ilYA(15), MAINTENANT);
  });

  it("un rendez-vous qui cite le chantier compte ; aucun autre ; sans agenda relié, on continue", async () => {
    const s = sources({ agenda: vi.fn(async () => [{ titre: "Point Garance", at: ilYA(3) }, { titre: "Garantie", at: ilYA(1) }]) });
    expect(await collecterMouvements("u1", chantiers, ilYA(60), s)).toEqual([{ cle: "projet:20", at: ilYA(3) }]);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const enPanne = sources({
      agenda: vi.fn(async () => { throw new Error("agenda non relié"); }),
      reponsesRecues: vi.fn(async () => [{ projetId: 20, at: ilYA(6) }]),
    });
    expect(await collecterMouvements("u1", chantiers, ilYA(60), enPanne)).toEqual([{ cle: "projet:20", at: ilYA(6) }]);
    err.mockRestore();
  });
});

describe("chantiersBloquesEnCache", () => {
  const carte: CarteFil = { objectifs: [], chainesSansObjectif: new Map(), depuis: ANCIEN };

  it("deux appels en moins de 20 min ne recalculent pas ; après 20 min, si", async () => {
    viderCacheChantiers();
    const calculer = vi.fn(async () => [{ libelle: "X", joursSansMouvement: 16, prochainPas: "Y" }]);
    await chantiersBloquesEnCache("u1", carte, MAINTENANT, calculer);
    const r = await chantiersBloquesEnCache("u1", carte, new Date(MAINTENANT.getTime() + 19 * 60_000), calculer);
    expect(r).toEqual([{ libelle: "X", joursSansMouvement: 16, prochainPas: "Y" }]);
    expect(calculer).toHaveBeenCalledTimes(1);
    await chantiersBloquesEnCache("u2", carte, MAINTENANT, calculer);
    expect(calculer).toHaveBeenCalledTimes(2);
    await chantiersBloquesEnCache("u1", carte, new Date(MAINTENANT.getTime() + 21 * 60_000), calculer);
    expect(calculer).toHaveBeenCalledTimes(3);
  });

  it("un échec n'est pas gardé", async () => {
    viderCacheChantiers();
    const calculer = vi.fn().mockRejectedValueOnce(new Error("base")).mockResolvedValue([]);
    await expect(chantiersBloquesEnCache("u1", carte, MAINTENANT, calculer)).rejects.toThrow("base");
    await expect(chantiersBloquesEnCache("u1", carte, MAINTENANT, calculer)).resolves.toEqual([]);
  });
});
