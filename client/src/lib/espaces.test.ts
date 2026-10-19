import { describe, it, expect } from "vitest";
import { ESPACES, espaceDuChemin, ongletsVisibles } from "./espaces";

describe("espaces", () => {
  it.each([
    ["/", "aujourdhui", "aujourdhui"], ["/planning", "aujourdhui", "semaine"],
    ["/projects/12", "projets", "projets"], ["/outreach/campaigns/3", "projets", "prospection"],
    ["/fondations?projet=2", "projets", "fondations"], ["/atelier", "creer", "atelier"],
    ["/campaigns", "creer", "campagnes"], ["/admin/profils-veille", "veille", "profils"],
    ["/mesure", "chiffres", "mesure"],
  ])("%s → %s / %s", (c, e, o) => expect(espaceDuChemin(c)).toEqual({ espace: e, onglet: o }));

  it.each(["/settings", "/onboarding", "/inconnu", "/rapport/abc", "/projectsfoo"])("%s → aucun espace", (c) =>
    expect(espaceDuChemin(c)).toBeNull());

  it("ignore la requête et l'ancre", () => {
    expect(espaceDuChemin("/?x=1")).toEqual({ espace: "aujourdhui", onglet: "aujourdhui" });
    expect(espaceDuChemin("/savoir#haut")).toEqual({ espace: "veille", onglet: "savoir" });
  });

  it("chaque route authentifiée de App.tsx (hors /settings et /onboarding) a un espace", () => {
    for (const r of ["/", "/content-calendar", "/reading-hub", "/outreach", "/analytics", "/strategy", "/projects", "/veille", "/fondations", "/mesure", "/savoir", "/admin/profils-veille", "/planning", "/campaigns", "/atelier"])
      expect(espaceDuChemin(r)).not.toBeNull();
  });

  it("les onglets propriétaire sont masqués aux autres", () => {
    const veille = ESPACES.find((e) => e.id === "veille")!;
    expect(ongletsVisibles(veille, false).map((o) => o.id)).toEqual(["tendances", "lecture"]);
    expect(ongletsVisibles(veille, true).map((o) => o.id)).toEqual(["tendances", "lecture", "savoir", "profils"]);
  });
});
