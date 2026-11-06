import { describe, it, expect } from "vitest";
import { texteNouveau, aUneCitation, texteAffiche, extraitDe } from "./citation";

describe("texteNouveau", () => {
  it("attribution Gmail sur une ligne", () => {
    expect(texteNouveau("Avec plaisir.\n\nLe lun. 2 nov. 2026 à 09:00, Jeanne <j@x.fr> a écrit :\n> Bonjour")).toBe("Avec plaisir.");
  });

  it("attribution Gmail repliée sur deux lignes (cas vu sur l'écran)", () => {
    const body = "Ça m'intéresse\n\nLe jeu. 5 nov. 2026 à 19:10, jeanne.mejean@agencejmd.com <\njeanne.mejean@agencejmd.com> a écrit :\n\n> Bonjour Marc,\n> Se désinscrire : https://x";
    expect(texteNouveau(body)).toBe("Ça m'intéresse");
  });

  it("attribution collée au texte, sans retour à la ligne", () => {
    const body = "Ça m'intéresse  Le jeu. 5 nov. 2026 à 19:10, jeanne.mejean@agencejmd.com <jeanne.mejean@agencejmd.com> a écrit : Bonjour Marc, …";
    expect(texteNouveau(body)).toBe("Ça m'intéresse");
  });

  it("anglais (Gmail, Outlook web)", () => {
    expect(texteNouveau("Ok\n\nOn Mon, Nov 2, 2026 at 9:00 AM Jeanne <j@x.fr> wrote:\n> hi")).toBe("Ok");
    expect(texteNouveau("Sounds good\nOn Thu, Nov 5, 2026 at 7:10 PM Jeanne Mejean <\nj@x.fr> wrote:\n> hi")).toBe("Sounds good");
  });

  it("Outlook : séparateur, De :, message d'origine", () => {
    expect(texteNouveau("Merci\n________________________________\nDe : Jeanne\nEnvoyé : jeudi")).toBe("Merci");
    expect(texteNouveau("Merci\n-----Original Message-----\nFrom: Jeanne")).toBe("Merci");
    expect(texteNouveau("Oui\n\nLe 05/11/2026 19:10, « Jeanne » a écrit :\nBonjour")).toBe("Oui");
  });

  it("lignes « > »", () => {
    expect(texteNouveau("Top\n> cité\n> encore")).toBe("Top");
  });

  it("garde le texte qui ressemble à une attribution sans en être une", () => {
    expect(texteNouveau("Le client a écrit : on verra. Rappelle-moi.")).toBe("Le client a écrit : on verra. Rappelle-moi.");
    expect(texteNouveau("Le projet me plaît.\nOn en parle lundi ?")).toBe("Le projet me plaît.\nOn en parle lundi ?");
  });

  it("garde la phrase qui précède et un nom contenant « Le »", () => {
    const body = "Le projet me plaît. Le 5 nov. 2026 à 19:10, Marie Le Gall <m@x.fr> a écrit : Bonjour";
    expect(texteNouveau(body)).toBe("Le projet me plaît.");
  });

  it("rien de cité : intact ; vide : vide", () => {
    expect(texteNouveau("Bonjour,\nOui pour jeudi.")).toBe("Bonjour,\nOui pour jeudi.");
    expect(texteNouveau(null)).toBe("");
  });
});

describe("affichage", () => {
  it("aUneCitation", () => {
    expect(aUneCitation("Oui\n> cité")).toBe(true);
    expect(aUneCitation("Oui")).toBe(false);
    expect(aUneCitation("> tout cité")).toBe(false);
  });
  it("texteAffiche ne rend jamais une bulle vide", () => {
    expect(texteAffiche("> tout cité")).toBe("> tout cité");
    expect(texteAffiche("Oui\n> cité")).toBe("Oui");
  });
  it("extraitDe : texte nouveau, espaces repliés, coupé", () => {
    expect(extraitDe("Ça m'intéresse\n\nLe jeu. 5 nov. 2026 à 19:10, j@x.fr <\nj@x.fr> a écrit :\n> x")).toBe("Ça m'intéresse");
    expect(extraitDe("a\n\nb")).toBe("a b");
    expect(extraitDe("x".repeat(200), 20)).toHaveLength(20);
    expect(extraitDe("")).toBeNull();
    expect(extraitDe(null)).toBeNull();
  });
});
