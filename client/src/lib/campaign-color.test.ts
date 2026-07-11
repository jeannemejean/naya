import { describe, it, expect } from "vitest";
import { hashString, campaignHue, campaignBadgeStyle, shortCampaignName } from "./campaign-color";

describe("campaign-color — couleur déterministe par campagne", () => {
  it("hashString est déterministe (même entrée → même sortie)", () => {
    expect(hashString("42")).toBe(hashString("42"));
    expect(hashString("Notorious")).toBe(hashString("Notorious"));
  });

  it("campaignHue renvoie une teinte 0-359 déterministe", () => {
    const h = campaignHue(7);
    expect(h).toBe(campaignHue(7));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it("condition : 2 campagnes distinctes → badges visuellement distincts", () => {
    const a = campaignBadgeStyle(1);
    const b = campaignBadgeStyle(2);
    expect(a.backgroundColor).not.toBe(b.backgroundColor);
    expect(campaignHue(1)).not.toBe(campaignHue(2));
  });

  it("plusieurs ids donnent des teintes majoritairement distinctes", () => {
    const hues = [1, 2, 3, 4, 5, 6, 7, 8].map(campaignHue);
    const unique = new Set(hues);
    expect(unique.size).toBeGreaterThanOrEqual(7); // très peu de collisions
  });

  it("badge lisible : fond clair + texte foncé de même teinte", () => {
    const s = campaignBadgeStyle(3);
    expect(s.backgroundColor).toMatch(/hsl\(\d+, 68%, 92%\)/);
    expect(s.color).toMatch(/hsl\(\d+, 55%, 30%\)/);
  });
});

describe("shortCampaignName", () => {
  it("retire le suffixe « — Prospection »", () => {
    expect(shortCampaignName("Notorious by Design — Prospection")).toBe("Notorious by Design");
  });
  it("gère le tiret simple", () => {
    expect(shortCampaignName("Speaker Kit - Prospection")).toBe("Speaker Kit");
  });
  it("tronque les noms trop longs", () => {
    expect(shortCampaignName("Campagne extrêmement longue sans séparateur ici", 20)).toHaveLength(20);
    expect(shortCampaignName("Campagne extrêmement longue sans séparateur ici", 20).endsWith("…")).toBe(true);
  });
  it("chaîne vide → vide", () => {
    expect(shortCampaignName("")).toBe("");
  });
});
