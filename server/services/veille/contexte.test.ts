import { describe, it, expect } from "vitest";
import { blocVeille } from "./contexte";

const c = (type: string, texte: string) => ({ type, texte, titre: texte });

describe("blocVeille", () => {
  it("rien à dire : bloc vide", () => {
    expect(blocVeille([])).toBe("");
  });
  it("met la voix du client d'abord et se limite à 8 lignes", () => {
    const xs = [
      ...Array.from({ length: 6 }, (_, i) => c("position", `pos ${i}`)),
      c("objection", "Trop cher"), c("vocabulaire", "« bougie qui coule »"), c("offre_concurrent", "Coffret à 39 €"),
    ];
    const b = blocVeille(xs as any);
    const lignes = b.split("\n").filter((l) => l.startsWith("- "));
    expect(lignes).toHaveLength(8);
    expect(lignes[0]).toContain("Trop cher");
    expect(lignes[1]).toContain("bougie qui coule");
    expect(b).toMatch(/n'invente/i);
  });
});
