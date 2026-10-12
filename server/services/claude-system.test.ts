import { describe, it, expect } from "vitest";
import { systemPromptPour, VOIX_TIERS } from "./claude";
import { NAYA_SYSTEM_VOICE } from "../naya-voice";

describe("systemPromptPour", () => {
  it("par défaut : la voix de Naya qui parle à l'utilisatrice", () => {
    const s = systemPromptPour("utilisatrice", "CTX", "");
    expect(s.startsWith(NAYA_SYSTEM_VOICE)).toBe(true);
    expect(s).toContain("CTX");
  });
  it("tiers : sans la voix d'assistante, avec la consigne d'écrire au nom de l'utilisatrice", () => {
    const s = systemPromptPour("tiers", "CTX", "EXTRA");
    expect(s).not.toContain(NAYA_SYSTEM_VOICE);
    expect(s).toContain(VOIX_TIERS);
    expect(s).toContain("CTX");
    expect(s).toContain("EXTRA");
  });
});
