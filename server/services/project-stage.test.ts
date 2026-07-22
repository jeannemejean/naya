import { describe, it, expect } from "vitest";
import { isValidStage, buildSituationPrompt, summarizeMilestones } from "./project-summary";

describe("isValidStage", () => {
  it("accepte les 4 stades", () => {
    for (const s of ["ideation", "early", "growth", "mature"]) expect(isValidStage(s)).toBe(true);
  });
  it("rejette le reste", () => {
    expect(isValidStage("croissance")).toBe(false);
    expect(isValidStage("")).toBe(false);
  });
});

describe("buildSituationPrompt", () => {
  it("contient le nom du projet et mentionne les priorités", () => {
    const prompt = buildSituationPrompt("Encore Merci");
    expect(prompt).toContain("Encore Merci");
    expect(prompt).toContain("priorités");
  });
});

describe("summarizeMilestones", () => {
  it("compte done/inProgress/upcoming sur un tableau mixte", () => {
    const milestones = [
      { status: "completed" },
      { status: "completed" },
      { status: "active" },
      { status: "unlocked" },
      { status: "locked" },
      { status: "locked" },
      { status: "locked" },
    ];
    expect(summarizeMilestones(milestones)).toEqual({ done: 2, inProgress: 2, upcoming: 3 });
  });

  it("ignore skipped (ne compte nulle part)", () => {
    const milestones = [
      { status: "completed" },
      { status: "skipped" },
      { status: "skipped" },
      { status: "locked" },
    ];
    expect(summarizeMilestones(milestones)).toEqual({ done: 1, inProgress: 0, upcoming: 1 });
  });

  it("tableau vide → tous les compteurs à zéro", () => {
    expect(summarizeMilestones([])).toEqual({ done: 0, inProgress: 0, upcoming: 0 });
  });
});
