// Chantiers sans mouvement (spec, points 2 et 5) : un chantier sans mouvement depuis 15 jours est
// signalé le matin avec son prochain pas ; un rendez-vous de l'agenda qui le cite compte comme
// mouvement. Toutes les sources sont injectées : aucun test ne touche une vraie base ni l'agenda.
import { describe, it, expect, vi } from "vitest";
import type { CarteFil, EtapeCarte, ObjectifCarte } from "./carte";
import {
  chantiersDe, evenementCite, chantiersSansMouvement, collecterMouvements, type Chantier, type SourcesMouvements,
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

  it("un mouvement du projet seul compte pour tous les chantiers du projet ; une autre étape ne compte pas", async () => {
    const s = sources({
      contenusPublies: vi.fn(async () => [{ projetId: 10, at: ilYA(1) }]),
      tachesFaites: vi.fn(async () => [{ etapeId: 999, objectifId: 1, projetId: 10, at: ilYA(2) }]),
    });
    const m = await collecterMouvements("u1", chantiers, ilYA(60), s);
    expect(m.filter((x) => x.at.getTime() === ilYA(1).getTime()).map((x) => x.cle).sort()).toEqual(["etape:101", "objectif:2"]);
    expect(m.filter((x) => x.at.getTime() === ilYA(2).getTime())).toEqual([]);
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
