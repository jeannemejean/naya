import { describe, expect, it } from "vitest";
import { jetonARenouveler, RENOUVELER_SOUS_S } from "./auth";

describe("jetonARenouveler", () => {
  const maintenant = 1_800_000_000;
  it("renouvelle un jeton qui expire dans moins de 15 jours", () => {
    expect(jetonARenouveler(maintenant + RENOUVELER_SOUS_S - 1, maintenant)).toBe(true);
    expect(jetonARenouveler(maintenant + 3600, maintenant)).toBe(true);
  });
  it("garde un jeton encore loin de son expiration", () => {
    expect(jetonARenouveler(maintenant + 29 * 24 * 3600, maintenant)).toBe(false);
  });
  it("sans date d'expiration : rien", () => {
    expect(jetonARenouveler(undefined, maintenant)).toBe(false);
  });
});
