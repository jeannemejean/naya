import { describe, it, expect } from "vitest";
import { resumeEnrolement } from "./enrolement-message";

describe("resumeEnrolement", () => {
  it("annonce les prospects enrôlés", () => {
    expect(resumeEnrolement({ enrolled: 2, skipped: 0 })).toBe("2 prospects enrôlés.");
    expect(resumeEnrolement({ enrolled: 1, skipped: 0 })).toBe("1 prospect enrôlé.");
  });

  it("dit combien attendent encore une validation", () => {
    expect(resumeEnrolement({ enrolled: 1, skipped: 4, skippedNotValidated: 3 })).toBe(
      "1 prospect enrôlé. 3 en attente de ta validation des messages, 1 déjà en cours ou hors campagne.",
    );
  });

  it("reste compatible avec une réponse sans skippedNotValidated", () => {
    expect(resumeEnrolement({ enrolled: 0, skipped: 2 })).toBe(
      "0 prospect enrôlé. 2 déjà en cours ou hors campagne.",
    );
  });
});
