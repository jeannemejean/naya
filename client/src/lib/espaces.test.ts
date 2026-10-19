import { describe, it, expect } from "vitest";
import { ESPACES, espaceDuChemin, estPageProjet, hrefEspace, ongletsVisibles } from "./espaces";
import fr from "@/locales/fr";
import en from "@/locales/en";

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

  // La page projet porte trois onglets qui appartiennent à d'autres espaces (?onglet=…).
  it.each([
    ["/projects/4?onglet=fondations", "projets", "fondations"],
    ["/projects/4?onglet=veille", "veille", "tendances"],
    ["/projects/4?onglet=mesure", "chiffres", "mesure"],
    ["/projects/4?onglet=client", "projets", "projets"],
    ["/projects/4?onglet=ensemble", "projets", "projets"],
    ["/projects/4", "projets", "projets"],
    ["/projects/4?x=1&onglet=veille#haut", "veille", "tendances"],
    ["/projects/4?onglet=toString", "projets", "projets"],
  ])("page projet %s → %s / %s", (c, espace, onglet) => expect(espaceDuChemin(c)).toEqual({ espace, onglet }));

  it("?onglet= ne compte que sur une page projet", () => {
    expect(espaceDuChemin("/projects?onglet=veille")).toEqual({ espace: "projets", onglet: "projets" });
    expect(espaceDuChemin("/strategy?onglet=mesure")).toEqual({ espace: "projets", onglet: "strategie" });
  });

  it("estPageProjet", () => {
    expect(estPageProjet("/projects/4")).toBe(true);
    expect(estPageProjet("/projects/4?onglet=veille")).toBe(true);
    expect(estPageProjet("/projects")).toBe(false);
    expect(estPageProjet("/strategy")).toBe(false);
  });

  describe("hrefEspace", () => {
    const e = (id: string) => ESPACES.find((x) => x.id === id)!;
    it("Veille : /veille avec un projet actif, sinon le premier onglet qui n'est pas une redirection", () => {
      expect(hrefEspace(e("veille"), 4)).toBe("/veille");
      expect(hrefEspace(e("veille"), null)).toBe("/reading-hub");
      expect(hrefEspace(e("veille"), null, true)).toBe("/reading-hub");
    });
    it("les autres espaces gardent leur adresse, projet actif ou non", () => {
      for (const id of ["aujourdhui", "projets", "creer", "chiffres"]) {
        expect(hrefEspace(e(id), null)).toBe(e(id).href);
        expect(hrefEspace(e(id), 4)).toBe(e(id).href);
      }
    });
    it("un espace dont tous les onglets sont des redirections garde son adresse", () => {
      const factice = { id: "veille" as const, cle: "x", href: "/veille", onglets: [{ id: "t", cle: "x", href: "/veille", prefixes: ["/veille"] }] };
      expect(hrefEspace(factice, null)).toBe("/veille");
    });
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

// Les clés sont fabriquées (`espaces.<espace>...`) : keys-exist.test ne les voit pas.
describe("libellés des espaces", () => {
  const resoudre = (d: unknown, cle: string) => cle.split(".").reduce<any>((o, p) => o?.[p], d);
  it.each([["fr", fr], ["en", en]] as const)("toutes les clés existent en %s", (_l, dico) => {
    const cles = ESPACES.flatMap((e) => [e.cle, ...e.onglets.map((o) => o.cle)]);
    expect(cles.filter((c) => typeof resoudre(dico, c) !== "string")).toEqual([]);
  });
});
