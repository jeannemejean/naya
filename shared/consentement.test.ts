import { describe, expect, it } from "vitest";
import { affirmeUneActionFaite, estConsentement } from "./consentement";

describe("estConsentement", () => {
  it.each([
    "oui", "Oui.", "oui !", "OK", "ok go", "vas-y", "vas y", "go", "parfait", "oui très bien",
    "très bien", "c'est bon", "d'accord", "valide", "je valide", "confirme", "oui vas-y", "yes",
    "oui oui", "top", "nickel", "👍", "oui 👍", "ok, fais-le", "fais-le", "oui, nettoie",
  ])("« %s » vaut consentement", (m) => {
    expect(estConsentement(m)).toBe(true);
  });

  it.each([
    "", "non", "oui mais garde l'atelier du 16", "oui sauf le 20", "pas encore", "attends",
    "oui ?", "c'est quoi ces tâches", "ok mais déplace plutôt au mardi",
    "les Draft JMD, ils ont déjà été mis en programmation là", "non merci", "oui et non",
    "oui, mais seulement les doublons", "parfait, et ensuite on regarde les posts de décembre ensemble",
  ])("« %s » ne vaut pas consentement", (m) => {
    expect(estConsentement(m)).toBe(false);
  });
});

describe("affirmeUneActionFaite", () => {
  it.each([
    "11 tâches supprimées. Planning nettoyé.",
    "C'est fait — les trois tâches sont repositionnées :",
    "C’est fait : j’ai déplacé l’atelier.",
    "Les posts sont déprogrammés.",
    "J'ai supprimé les doublons.",
  ])("« %s » annonce une action faite", (t) => {
    expect(affirmeUneActionFaite(t)).toBe(true);
  });

  it.each([
    "11 tâches à supprimer — confirme et c'est fait :",
    "Voilà ce que ça supprime — confirme et c'est fait :",
    "Je te propose de déplacer l'atelier au mardi. Tu valides ?",
    "Lundi après-midi = tournage Jeanne, c'est ancré.",
  ])("« %s » n'annonce rien de fait", (t) => {
    expect(affirmeUneActionFaite(t)).toBe(false);
  });
});

describe("affirmeUneActionFaite — campagnes repensées", () => {
  it("« repensée » et « j'ai repensé » annoncent un geste fait", () => {
    expect(affirmeUneActionFaite("La campagne est repensée.")).toBe(true);
    expect(affirmeUneActionFaite("J'ai repensé la campagne JMD.")).toBe(true);
  });
  it("proposer de repenser n'est pas l'annoncer", () => {
    expect(affirmeUneActionFaite("Je te propose de repenser la campagne.")).toBe(false);
  });
});
