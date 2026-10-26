import { describe, it, expect } from "vitest";
import { classer, planRepriseAtelier } from "./tri";

// Lundi → vendredi travaillés.
const ouvre = (d: string) => { const j = new Date(`${d}T12:00:00Z`).getUTCDay(); return j >= 1 && j <= 5; };
const atelier = (id: number, jour: string | null, partie = 1) => ({ id, taskType: "atelier_contenu", scheduledDate: jour, actionData: { semaine: "2026-10-26", partie } });
const validation = (id: number, jour: string | null) => ({ id, taskType: "atelier_validation", scheduledDate: jour, actionData: { semaine: "2026-10-26" } });

describe("classer", () => {
  it("chaque tâche suit son propriétaire", () => {
    expect(classer({ id: 1, ritualId: 4 })).toEqual({ genre: "rituel" });
    expect(classer({ id: 1, taskType: "prospection_validation" })).toEqual({ genre: "ignorer" });
    expect(classer({ id: 1, type: "milestone" })).toEqual({ genre: "ignorer" });
    expect(classer({ id: 1, contentId: 196 })).toEqual({ genre: "etapePost", contentId: 196 });
    expect(classer({ id: 1, taskType: "atelier_validation", actionData: { semaine: "2026-10-26" } })).toEqual({ genre: "atelier", semaine: "2026-10-26" });
    expect(classer({ id: 1, taskType: "generic" })).toEqual({ genre: "libre" });
  });

  it("une tâche d'atelier sans semaine lisible est confiée à Naya", () => {
    expect(classer({ id: 1, taskType: "atelier_contenu", actionData: {} })).toEqual({ genre: "libre" });
  });
});

describe("planRepriseAtelier", () => {
  it("plus aucun post à produire : tout s'archive (l'atelier du 12 oct. reporté sept fois)", () => {
    const p = planRepriseAtelier({ taches: [atelier(922, "2026-10-27")], joursPostsRestants: [], cible: "2026-10-27", estTravaille: ouvre });
    expect(p).toEqual({ archiver: [922], placer: [] });
  });

  it("le cas réel : la validation (mardi) passait avant l'atelier (mercredi) — elle repasse après", () => {
    const p = planRepriseAtelier({
      taches: [atelier(925, "2026-10-28"), validation(926, "2026-10-27")],
      joursPostsRestants: ["2026-10-30"], cible: "2026-10-27", estTravaille: ouvre,
    });
    expect(p.archiver).toEqual([]);
    expect(p.placer).toEqual([{ id: 926, jour: "2026-10-29" }]); // l'atelier reste le 28
  });

  it("un atelier en retard revient au premier jour, la validation le lendemain", () => {
    const p = planRepriseAtelier({
      taches: [atelier(1, "2026-10-20"), validation(2, "2026-10-21")],
      joursPostsRestants: ["2026-10-29"], cible: "2026-10-26", estTravaille: ouvre,
    });
    expect(p.placer).toEqual([{ id: 1, jour: "2026-10-26" }, { id: 2, jour: "2026-10-27" }]);
  });

  it("plus le temps d'un lendemain avant le premier post : la validation suit l'atelier le même jour", () => {
    const p = planRepriseAtelier({
      taches: [atelier(1, "2026-10-22"), validation(2, "2026-10-23")],
      joursPostsRestants: ["2026-10-27"], cible: "2026-10-26", estTravaille: ouvre,
    });
    expect(p.placer).toEqual([{ id: 1, jour: "2026-10-26" }, { id: 2, jour: "2026-10-26" }]);
  });

  it("les parties restent dans l'ordre et jamais un week-end", () => {
    const p = planRepriseAtelier({
      taches: [atelier(2, "2026-10-21", 2), atelier(1, "2026-10-29", 1)],
      joursPostsRestants: ["2026-11-02"], cible: "2026-10-24", estTravaille: ouvre,
    });
    // cible samedi → lundi 26 ; la partie 1 reste le 29, la partie 2 ne passe pas avant.
    expect(p.placer).toEqual([{ id: 2, jour: "2026-10-29" }]);
  });

  it("une partie posée après la veille du premier post y revient", () => {
    const p = planRepriseAtelier({
      taches: [atelier(1, "2026-10-30")],
      joursPostsRestants: ["2026-10-29"], cible: "2026-10-26", estTravaille: ouvre,
    });
    expect(p.placer).toEqual([{ id: 1, jour: "2026-10-28" }]);
  });
});
