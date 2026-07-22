import { describe, it, expect } from "vitest";
import { isValidStage } from "./project-summary";

describe("isValidStage", () => {
  it("accepte les 4 stades", () => {
    for (const s of ["ideation", "early", "growth", "mature"]) expect(isValidStage(s)).toBe(true);
  });
  it("rejette le reste", () => {
    expect(isValidStage("croissance")).toBe(false);
    expect(isValidStage("")).toBe(false);
  });
});
