import { describe, it, expect } from "vitest";
import { semaineDepuisRecherche, postSuivant, aValider, progression } from "./navigation";

describe("semaineDepuisRecherche", () => {
  it("lit ?semaine= quand c'est un lundi", () => {
    expect(semaineDepuisRecherche("?semaine=2026-10-19", "2026-10-14")).toBe("2026-10-19");
  });
  it("un autre jour est ramené à son lundi ; absent ou illisible → la semaine en cours", () => {
    expect(semaineDepuisRecherche("?semaine=2026-10-22", "2026-10-14")).toBe("2026-10-19");
    expect(semaineDepuisRecherche("", "2026-10-14")).toBe("2026-10-12");
    expect(semaineDepuisRecherche("?semaine=n'importe", "2026-10-14")).toBe("2026-10-12");
  });
});

const p = (id: number, etat: string) => ({ id, etat }) as any;

describe("postSuivant", () => {
  it("le prochain post à valider après celui-ci, puis on reprend au début", () => {
    const posts = [p(1, "valide"), p(2, "brouillon"), p(3, "valide"), p(4, "a_rediger")];
    expect(postSuivant(posts, 2)).toBe(4);
    expect(postSuivant(posts, 4)).toBe(2);
  });
  it("plus rien à valider → null", () => {
    expect(postSuivant([p(1, "valide"), p(2, "publie")], 1)).toBeNull();
  });
});

describe("aValider et progression", () => {
  it("compte les posts validés ou publiés sur le total", () => {
    const posts = [p(1, "valide"), p(2, "brouillon"), p(3, "publie"), p(4, "a_rediger")];
    expect(aValider(posts[1])).toBe(true);
    expect(aValider(posts[0])).toBe(false);
    expect(progression(posts)).toEqual({ faits: 2, total: 4 });
  });
});
