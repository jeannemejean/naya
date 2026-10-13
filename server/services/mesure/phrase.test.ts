import { describe, it, expect } from "vitest";
import { completerMois, lirePhrase } from "./phrase";

describe("completerMois — seuls les chiffres dits sont écrits", () => {
  const existant = { ca: 10000, caNouveaux: null, nouveauxClients: 20, commandes: null, coutsVariables: 500, depenses: { paid_social: 1000, outils: 200 } };
  it("garde les champs et canaux non dits", () => {
    const r = completerMois(existant, { nouveauxClients: 25, depenses: { google_ads: 300 } });
    expect(r).toEqual({ ok: true, valeur: { ca: 10000, caNouveaux: null, nouveauxClients: 25, commandes: null, coutsVariables: 500, depenses: { paid_social: 1000, outils: 200, google_ads: 300 } } });
  });
  it("une valeur vide (null, espace) n'efface jamais un chiffre existant", () => {
    const r = completerMois(existant, { ca: " ", nouveauxClients: 25, depenses: { paid_social: null, outils: "" } });
    expect(r).toEqual({ ok: true, valeur: { ...existant, nouveauxClients: 25 } });
  });
  it("lirePhrase refuse un nombre de clients non entier (l'enregistrement le refuserait)", () => {
    expect(lirePhrase('{"mois":"2026-09","nouveauxClients":20.5,"ca":100}', new Date("2026-10-13T10:00:00Z"))).toEqual({ ok: true, mois: "2026-09", champs: { ca: 100 } });
  });
  it("mois par défaut à l'heure de Paris : le 1er octobre à 0 h 30 (encore septembre en UTC), le mois écoulé est septembre", () => {
    expect(lirePhrase('{"ca":1}', new Date("2026-09-30T22:30:00Z"))).toMatchObject({ ok: true, mois: "2026-09" });
  });
  it("sans existant : les seuls chiffres dits", () => {
    expect(completerMois(undefined, { ca: 5000 })).toEqual({ ok: true, valeur: { ca: 5000, caNouveaux: null, nouveauxClients: null, commandes: null, coutsVariables: null, depenses: {} } });
  });
  it("mêmes validations : rien de dit, valeur négative, CA nouveaux > CA après fusion", () => {
    expect(completerMois(existant, {})).toEqual({ ok: false, erreur: "mois_vide" });
    expect(completerMois(existant, { ca: -3 })).toEqual({ ok: false, erreur: "ca_invalide" });
    expect(completerMois(existant, { caNouveaux: 20000 })).toEqual({ ok: false, erreur: "ca_nouveaux_superieur" });
  });
});

describe("lirePhrase — ce que Naya a compris, sans rien inventer", () => {
  const AUJ = new Date("2026-10-13T10:00:00Z");
  it("lit les champs et les canaux connus ; ignore un canal inventé", () => {
    const r = lirePhrase('{"mois":"2026-09","ca":12000,"nouveauxClients":20,"depenses":{"paid_social":2000,"tiktok_magique":50}}', AUJ);
    expect(r).toEqual({ ok: true, mois: "2026-09", champs: { ca: 12000, nouveauxClients: 20, depenses: { paid_social: 2000 } } });
  });
  it("sans mois : le mois écoulé", () => {
    const r = lirePhrase('{"ca":12000}', AUJ);
    expect(r).toMatchObject({ ok: true, mois: "2026-09" });
  });
  it("mois futur ou illisible → mois écoulé refusé proprement", () => {
    expect(lirePhrase('{"mois":"2027-01","ca":1}', AUJ)).toEqual({ ok: false, erreur: "mois_invalide" });
  });
  it("aucun chiffre compris ou sortie illisible → erreur, rien d'inventé", () => {
    expect(lirePhrase('{"mois":"2026-09"}', AUJ)).toEqual({ ok: false, erreur: "rien_compris" });
    expect(lirePhrase("je ne sais pas", AUJ)).toEqual({ ok: false, erreur: "rien_compris" });
    expect(lirePhrase('{"ca":"beaucoup"}', AUJ)).toEqual({ ok: false, erreur: "rien_compris" });
  });
});
