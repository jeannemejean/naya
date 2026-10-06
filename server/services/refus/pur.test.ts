import { describe, it, expect } from "vitest";
import { estRaisonRefus, libelleRaison, texteSouvenirRefus, ligneContexteRefus, validerRemplacement, RAISONS_REFUS } from "./pur";

describe("estRaisonRefus", () => {
  it("accepte les raisons connues", () => {
    for (const r of RAISONS_REFUS) expect(estRaisonRefus(r)).toBe(true);
  });
  it("refuse le reste", () => {
    expect(estRaisonRefus("nope")).toBe(false);
    expect(estRaisonRefus(3)).toBe(false);
    expect(estRaisonRefus(undefined)).toBe(false);
  });
});

describe("texteSouvenirRefus", () => {
  it("null si texte vide", () => {
    expect(texteSouvenirRefus("T", "other", "")).toBeNull();
    expect(texteSouvenirRefus("T", "other", "   ")).toBeNull();
    expect(texteSouvenirRefus("T", "other", undefined)).toBeNull();
  });
  it("format exact", () => {
    expect(texteSouvenirRefus("Appeler X", "wrong_timing", "pas cette semaine")).toBe(
      "A refusé la tâche « Appeler X » (mauvais moment) : pas cette semaine",
    );
  });
  it("mentionne le projet", () => {
    expect(texteSouvenirRefus("Appeler X", "wrong_timing", "non", "Marque Y")).toBe(
      "A refusé la tâche « Appeler X » (projet « Marque Y », mauvais moment) : non",
    );
  });
  it("tronque à 1500", () => {
    const t = texteSouvenirRefus("T", "other", "a".repeat(2000))!;
    expect(t.endsWith("…")).toBe(true);
    expect(t).toContain("a".repeat(1500) + "…");
    expect(t).not.toContain("a".repeat(1501));
  });
});

describe("libelleRaison", () => {
  it("libellés lisibles", () => {
    expect(libelleRaison("not_useful")).toBe("pas utile");
    expect(libelleRaison("already_done")).toBe("déjà fait");
  });
});

describe("ligneContexteRefus", () => {
  const base = { taskTitle: "T", taskType: "a", taskCategory: "b", taskSource: "ai", feedbackType: "refused", reason: "too_vague" };
  it("identique à l'ancien format sans texte", () => {
    expect(ligneContexteRefus(base)).toBe("- T (a/b, source: ai) — refused, reason: too_vague");
    expect(ligneContexteRefus({ taskTitle: "T", feedbackType: "deleted", reason: "r" })).toBe("- T (/, source: unknown) — deleted, reason: r");
  });
  it("ajoute le texte", () => {
    expect(ligneContexteRefus({ ...base, freeText: "bof" })).toBe('- T (a/b, source: ai) — refused, reason: too_vague — "bof"');
  });
  it("tronque à 300", () => {
    const l = ligneContexteRefus({ ...base, freeText: "z".repeat(500) });
    expect(l).toContain("z".repeat(300));
    expect(l).not.toContain("z".repeat(301));
  });
});

describe("validerRemplacement", () => {
  const ok = { title: "T", description: "D", type: "x", category: "y", estimatedDuration: 45 };
  it("objet valide", () => {
    expect(validerRemplacement(ok, 30)).toMatchObject(ok);
  });
  it("title/description manquants ou non-string → null", () => {
    expect(validerRemplacement({ ...ok, title: undefined }, 30)).toBeNull();
    expect(validerRemplacement({ ...ok, description: undefined }, 30)).toBeNull();
    expect(validerRemplacement({ ...ok, title: 3 }, 30)).toBeNull();
    expect(validerRemplacement({ ...ok, description: {} }, 30)).toBeNull();
    expect(validerRemplacement(null, 30)).toBeNull();
    expect(validerRemplacement("x", 30)).toBeNull();
  });
  it("durée bornée", () => {
    expect(validerRemplacement({ ...ok, estimatedDuration: 5 }, 30)!.estimatedDuration).toBe(15);
    expect(validerRemplacement({ ...ok, estimatedDuration: 999 }, 30)!.estimatedDuration).toBe(240);
  });
  it("durée par défaut", () => {
    const { estimatedDuration, ...sans } = ok;
    expect(validerRemplacement(sans, 60)!.estimatedDuration).toBe(60);
    expect(validerRemplacement(sans, null)!.estimatedDuration).toBe(30);
  });
  it("défauts type/category et troncature titre", () => {
    const r = validerRemplacement({ title: "t".repeat(300), description: "D" }, 30)!;
    expect(r.type).toBe("generic");
    expect(r.category).toBe("general");
    expect(r.title.length).toBe(200);
  });
});
