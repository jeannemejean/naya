// Rattachement explicite d'une tâche à une étape et à un objectif, et garde contre les
// « pourquoi » creux. `choisirRattachement` est pur ; `rattacherAvantCreation` et le
// rattacheur d'un passage chargent la carte via `chargerCarte` (mocké : aucune requête).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CarteFil, EtapeCarte, ObjectifCarte } from "./carte";

const chargerCarteMock = vi.hoisted(() => vi.fn());
vi.mock("./carte", async (importOriginal) => {
  const vrai = await importOriginal<typeof import("./carte")>();
  return { ...vrai, chargerCarte: chargerCarteMock };
});
vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));

import { bornerPourquoi, canalDe, choisirRattachement, classeObjectif, estPourquoiCreux, rattachementTacheGeneree, rattacherAvantCreation, rattacheurDuPassage } from "./rattachement";

const etape = (id: number, objectifId: number | null, projetId: number, ordre: number, statut: string): EtapeCarte =>
  ({ id, objectifId, projetId, titre: `E${id}`, pourquoi: null, statut, ordre, faites: 0, prevues: 0 });
const objectif = (id: number, projetId: number, successMode: string, goalType: string, etapes: EtapeCarte[]): ObjectifCarte =>
  ({ id, projetId, titre: `O${id}`, successMode, goalType, cible: null, dueDate: null, etapes });

/** Projet 7 : un objectif revenue (1), un objectif visibility (2). Projet 8 : deux objectifs visibility. */
function carte(): CarteFil {
  return {
    objectifs: [
      objectif(1, 7, "revenue", "monthly", [etape(10, 1, 7, 0, "completed"), etape(11, 1, 7, 1, "active"), etape(12, 1, 7, 2, "locked")]),
      objectif(2, 7, "consistency", "visibility", [etape(20, 2, 7, 0, "active"), etape(21, 2, 7, 1, "locked")]),
      objectif(3, 8, "visibility", "monthly", [etape(30, 3, 8, 0, "active")]),
      objectif(4, 8, "visibility", "monthly", []),
      // Projet 9 : la seule étape non faite est verrouillée (Review Focus 1).
      objectif(5, 9, "revenue", "revenue", [etape(50, 5, 9, 0, "completed"), etape(51, 5, 9, 1, "locked")]),
      // Projet 10 : pas de visibility, un seul consistency.
      objectif(6, 10, "consistency", "monthly", [etape(60, 6, 10, 0, "unlocked")]),
    ],
    chainesSansObjectif: new Map([[7, [etape(70, null, 7, 0, "active"), etape(71, null, 7, 1, "locked")]]]),
    depuis: null,
  };
}

describe("canalDe", () => {
  it("contenu : contentId, post_publish, canva_task, type content, tâches d'atelier", () => {
    expect(canalDe({ projectId: 7, contentId: 3 })).toBe("contenu");
    expect(canalDe({ projectId: 7, taskType: "post_publish" })).toBe("contenu");
    expect(canalDe({ projectId: 7, taskType: "canva_task" })).toBe("contenu");
    expect(canalDe({ projectId: 7, type: "content" })).toBe("contenu");
    expect(canalDe({ projectId: null, taskType: "atelier_contenu" })).toBe("contenu");
    expect(canalDe({ projectId: null, taskType: "atelier_validation" })).toBe("contenu");
  });
  it("prospection : leadId, linkedin_message, outreach_action, email, prospection_validation", () => {
    expect(canalDe({ projectId: 7, leadId: 4 })).toBe("prospection");
    for (const taskType of ["linkedin_message", "outreach_action", "email", "prospection_validation"]) {
      expect(canalDe({ projectId: 7, taskType })).toBe("prospection");
    }
  });
  it("autre sinon", () => {
    expect(canalDe({ projectId: 7, type: "planning", campaignId: 2 })).toBe("autre");
  });
});

describe("choisirRattachement", () => {
  it("règle 1 : un milestoneId explicite non verrouillé donne son objectif", () => {
    expect(choisirRattachement({ projectId: 7, milestoneId: 11 }, carte())).toEqual({ goalId: 1, milestoneId: 11 });
    // Une étape de chaîne de projet (sans objectif) reste sans objectif.
    expect(choisirRattachement({ projectId: 7, milestoneId: 70 }, carte())).toEqual({ goalId: null, milestoneId: 70 });
  });

  it("règle 1, jamais une étape locked : le milestoneId verrouillé est ignoré", () => {
    expect(choisirRattachement({ projectId: 7, milestoneId: 12 }, carte())).toEqual({ goalId: null, milestoneId: null });
    expect(choisirRattachement({ projectId: 7, milestoneId: 71 }, carte())).toEqual({ goalId: null, milestoneId: null });
  });

  it("règle 2 : un goalId explicite prend l'étape active de sa chaîne", () => {
    expect(choisirRattachement({ projectId: 7, goalId: 1 }, carte())).toEqual({ goalId: 1, milestoneId: 11 });
    expect(choisirRattachement({ projectId: 8, goalId: 4 }, carte())).toEqual({ goalId: 4, milestoneId: null });
  });

  it("règle 2 (Review Focus 1) : la seule étape non faite est locked → goalId posé, milestoneId null", () => {
    expect(choisirRattachement({ projectId: 9, goalId: 5 }, carte())).toEqual({ goalId: 5, milestoneId: null });
  });

  it("règle 3 : contenu → l'unique objectif visibility du projet (goalType ou successMode)", () => {
    expect(choisirRattachement({ projectId: 7, contentId: 9 }, carte())).toEqual({ goalId: 2, milestoneId: 20 });
  });

  it("règle 3 : à défaut de visibility, l'unique consistency", () => {
    expect(choisirRattachement({ projectId: 10, taskType: "post_publish" }, carte())).toEqual({ goalId: 6, milestoneId: 60 });
  });

  it("règle 3 (Review Focus 2) : deux objectifs visibility actifs → {null, null}", () => {
    expect(choisirRattachement({ projectId: 8, type: "content" }, carte())).toEqual({ goalId: null, milestoneId: null });
  });

  it("règle 3 : tâche d'atelier sans projet → l'unique objectif visibility de toute la carte, sinon rien", () => {
    // Projets 7 et 8 réunis : trois objectifs visibility → ambigu.
    expect(choisirRattachement({ projectId: null, taskType: "atelier_contenu" }, carte())).toEqual({ goalId: null, milestoneId: null });
    const seule: CarteFil = { ...carte(), objectifs: carte().objectifs.filter((o) => o.projetId === 7) };
    expect(choisirRattachement({ projectId: null, taskType: "atelier_contenu" }, seule)).toEqual({ goalId: 2, milestoneId: 20 });
  });

  it("règle 4 : prospection → l'unique objectif revenue du projet", () => {
    expect(choisirRattachement({ projectId: 7, leadId: 3 }, carte())).toEqual({ goalId: 1, milestoneId: 11 });
    expect(choisirRattachement({ projectId: 7, taskType: "prospection_validation" }, carte())).toEqual({ goalId: 1, milestoneId: 11 });
    // Projet 9 : objectif revenue dont la seule étape restante est verrouillée.
    expect(choisirRattachement({ projectId: 9, taskType: "linkedin_message" }, carte())).toEqual({ goalId: 5, milestoneId: null });
  });

  it("règle 5 : canal autre, ou aucun objectif du bon type → {null, null}", () => {
    expect(choisirRattachement({ projectId: 7, type: "planning" }, carte())).toEqual({ goalId: null, milestoneId: null });
    expect(choisirRattachement({ projectId: 8, leadId: 1 }, carte())).toEqual({ goalId: null, milestoneId: null });
    expect(choisirRattachement({ projectId: null, leadId: 1 }, { objectifs: [], chainesSansObjectif: new Map(), depuis: null }))
      .toEqual({ goalId: null, milestoneId: null });
  });

  it("règle 6 : jamais une étape locked, quel que soit le chemin", () => {
    const c = carte();
    const toutes = [...c.objectifs.flatMap((o) => o.etapes), ...Array.from(c.chainesSansObjectif.values()).flat()];
    const verrouillees = new Set(toutes.filter((e) => e.statut === "locked").map((e) => e.id));
    const brouillons = [
      ...toutes.map((e) => ({ projectId: e.projetId, milestoneId: e.id })),
      ...c.objectifs.map((o) => ({ projectId: o.projetId, goalId: o.id })),
      ...[7, 8, 9, 10].flatMap((p) => [{ projectId: p, contentId: 1 }, { projectId: p, leadId: 1 }]),
    ];
    for (const b of brouillons) {
      const r = choisirRattachement(b, c);
      if (r.milestoneId != null) expect(verrouillees.has(r.milestoneId)).toBe(false);
    }
  });
});

describe("classe d'un objectif (correctif I1 : successMode vaut visibility par défaut)", () => {
  const projet = (objectifs: ObjectifCarte[]): CarteFil => ({ objectifs, chainesSansObjectif: new Map(), depuis: null });

  it("goalType explicite (revenue|visibility|consistency) l'emporte, sinon successMode", () => {
    expect(classeObjectif({ goalType: "revenue", successMode: "visibility" })).toBe("revenue");
    expect(classeObjectif({ goalType: "monthly", successMode: "visibility" })).toBe("visibility");
    expect(classeObjectif({ goalType: "quarterly", successMode: "revenue" })).toBe("revenue");
  });

  it("goalType revenue + successMode par défaut : PAS une cible de contenu", () => {
    const c = projet([objectif(1, 7, "visibility", "revenue", [etape(10, 1, 7, 0, "active")])]);
    expect(choisirRattachement({ projectId: 7, contentId: 1 }, c)).toEqual({ goalId: null, milestoneId: null });
    expect(choisirRattachement({ projectId: 7, leadId: 1 }, c)).toEqual({ goalId: 1, milestoneId: 10 });
  });

  it("objectif revenue (successMode par défaut) à côté d'un vrai objectif visibility : le contenu va sans ambiguïté au second", () => {
    const c = projet([
      objectif(1, 7, "visibility", "revenue", [etape(10, 1, 7, 0, "active")]),
      objectif(2, 7, "visibility", "monthly", [etape(20, 2, 7, 0, "active")]),
    ]);
    expect(choisirRattachement({ projectId: 7, contentId: 1 }, c)).toEqual({ goalId: 2, milestoneId: 20 });
    expect(choisirRattachement({ projectId: 7, leadId: 1 }, c)).toEqual({ goalId: 1, milestoneId: 10 });
  });
});

describe("tâches de campagne (correctif I2)", () => {
  it("hors contenu : l'unique objectif de classe visibility du projet de la campagne", () => {
    expect(choisirRattachement({ projectId: 7, campaignId: 3, type: "planning" }, carte())).toEqual({ goalId: 2, milestoneId: 20 });
  });
  it("contenu : la règle de contenu", () => {
    expect(choisirRattachement({ projectId: 10, campaignId: 3, type: "content" }, carte())).toEqual({ goalId: 6, milestoneId: 60 });
  });
  it("aucun objectif visibility (pas de repli consistency), ou plusieurs : {null, null}", () => {
    expect(choisirRattachement({ projectId: 10, campaignId: 3, type: "planning" }, carte())).toEqual({ goalId: null, milestoneId: null });
    expect(choisirRattachement({ projectId: 8, campaignId: 3, type: "planning" }, carte())).toEqual({ goalId: null, milestoneId: null });
  });
  it("jamais une étape locked : objectif visibility dont l'étape restante est verrouillée → milestoneId null", () => {
    const c: CarteFil = { objectifs: [objectif(1, 7, "visibility", "monthly", [etape(10, 1, 7, 0, "locked")])], chainesSansObjectif: new Map(), depuis: null };
    expect(choisirRattachement({ projectId: 7, campaignId: 3, type: "planning" }, c)).toEqual({ goalId: 1, milestoneId: null });
  });
});

describe("bornerPourquoi (300 caractères)", () => {
  it("court : inchangé (espaces normalisés)", () => {
    expect(bornerPourquoi("  Sans ce devis,  l'étape reste bloquée. ")).toBe("Sans ce devis, l'étape reste bloquée.");
  });
  it("long : coupé à la fin de la première phrase", () => {
    const p = "Sans ce devis signé, l'étape « 1er client » reste bloquée. " + "x ".repeat(200);
    expect(bornerPourquoi(p)).toBe("Sans ce devis signé, l'étape « 1er client » reste bloquée.");
  });
  it("long sans fin de phrase avant 300 : coupé au dernier mot, avec une ellipse", () => {
    const r = bornerPourquoi("mot ".repeat(120));
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.endsWith("mot…")).toBe(true);
  });
  it("appliqué au pourquoi d'une tâche générée", () => {
    const r = rattachementTacheGeneree({
      tache: { goalIndex: "0", etapeIndex: 0, pourquoi: "Sans ce devis signé, l'étape reste bloquée. " + "y".repeat(400) },
      objectifs: [{ id: 1 }], etapesParObjectif: new Map([[1, [{ id: 11 }]]]), projectId: 7, carte: null,
    });
    expect(r).toEqual({ goalId: 1, milestoneId: 11, pourquoi: "Sans ce devis signé, l'étape reste bloquée." });
  });
});

describe("estPourquoiCreux", () => {
  it("formules creuses et phrases trop courtes", () => {
    expect(estPourquoiCreux("pour avancer ton objectif")).toBe(true);
    expect(estPourquoiCreux("Pour avancer ton objectif.")).toBe(true);
    expect(estPourquoiCreux("To move your goal forward")).toBe(true);
    expect(estPourquoiCreux("Ça fait avancer le projet")).toBe(true);
    expect(estPourquoiCreux("Débloque l'étape")).toBe(true); // < 25 caractères
    expect(estPourquoiCreux("")).toBe(true);
    expect(estPourquoiCreux(null)).toBe(true);
    expect(estPourquoiCreux(undefined)).toBe(true);
  });
  it("une phrase qui nomme l'étape et ce qu'elle débloque n'est pas creuse", () => {
    expect(estPourquoiCreux("Sans ce devis signé, l'étape « 1er client IN SCENA » reste bloquée")).toBe(false);
  });
});

describe("rattacherAvantCreation et rattacheur d'un passage", () => {
  beforeEach(() => {
    chargerCarteMock.mockReset();
    chargerCarteMock.mockResolvedValue(carte());
  });

  it("utilise la carte fournie sans la recharger", async () => {
    expect(await rattacherAvantCreation("u1", { projectId: 7, leadId: 1 }, carte())).toEqual({ goalId: 1, milestoneId: 11 });
    expect(chargerCarteMock).not.toHaveBeenCalled();
  });

  it("charge la carte quand elle n'est pas fournie", async () => {
    expect(await rattacherAvantCreation("u1", { projectId: 7, contentId: 1 })).toEqual({ goalId: 2, milestoneId: 20 });
    expect(chargerCarteMock).toHaveBeenCalledTimes(1);
  });

  it("hors interrupteur : rien à poser, aucune carte chargée", async () => {
    const r = rattacheurDuPassage("u1", { FIL_CONDUCTEUR_USERS: "autre" } as any);
    expect(await r({ projectId: 7, leadId: 1 })).toEqual({});
    expect(chargerCarteMock).not.toHaveBeenCalled();
  });

  it("dans l'interrupteur : la carte est chargée une seule fois pour tout le passage", async () => {
    const r = rattacheurDuPassage("u1", { FIL_CONDUCTEUR_USERS: "u1" } as any);
    expect(await r({ projectId: 7, leadId: 1 })).toEqual({ goalId: 1, milestoneId: 11 });
    expect(await r({ projectId: 7, contentId: 1 })).toEqual({ goalId: 2, milestoneId: 20 });
    expect(await r({ projectId: 7, type: "planning" })).toEqual({ goalId: null, milestoneId: null });
    expect(chargerCarteMock).toHaveBeenCalledTimes(1);
  });

  it("une tâche qui a déjà un goalId n'est pas touchée", async () => {
    const r = rattacheurDuPassage("u1", { FIL_CONDUCTEUR_USERS: "u1" } as any);
    expect(await r({ projectId: 7, goalId: 1, leadId: 1 })).toEqual({});
    expect(chargerCarteMock).not.toHaveBeenCalled();
  });

  it("carte illisible : rien n'est posé, la création n'est pas bloquée", async () => {
    chargerCarteMock.mockRejectedValue(new Error("db"));
    const r = rattacheurDuPassage("u1", { FIL_CONDUCTEUR_USERS: "u1" } as any);
    expect(await r({ projectId: 7, leadId: 1 })).toEqual({});
  });
});
