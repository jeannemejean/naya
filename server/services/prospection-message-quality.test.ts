import { describe, it, expect } from "vitest";
import { defautsDuMessage, incoherenceDeGenre } from "./prospection-message-quality";

/**
 * Contrôle de qualité des messages de prospection.
 *
 * Fondé sur les 41 messages RÉELLEMENT produits en production, lus le 18 septembre 2026 :
 *   39/41 contenaient une question, 31/41 se TERMINAIENT par une question,
 *   13 disaient « curieuse » et 1 disait « curieux ».
 *
 * Le validateur existant ne regardait que la longueur, le nombre de phrases et les tirets
 * longs. Rien sur ce qui donne envie de lire.
 *
 * Ces règles ne remplacent pas le jugement : elles attrapent les défauts qu'on a vus, pas
 * tous les mauvais messages possibles.
 */
describe("defautsDuMessage", () => {
  it("ne signale rien sur un message correct", () => {
    const m =
      "Votre dernier lancement misait sur la rareté plutôt que sur le volume, à contre-courant du secteur. C'est exactement le terrain qu'on travaille. Jeanne";

    expect(defautsDuMessage(m)).toEqual([]);
  });

  it("signale un message qui se TERMINE par une question ouverte", () => {
    // 31 messages sur 41 finissaient ainsi. C'est la formule qui fait fermer le message :
    // la dernière chose que le prospect lit est une demande de travail gratuit.
    const m = "Chanel désirable par soustraction. Comment vous pensez cet équilibre localement ? Jeanne";

    expect(defautsDuMessage(m)).toContain("finit_par_question");
  });

  it("tolère une question qui n'est pas le dernier mot", () => {
    // Une question au milieu, suivie d'autre chose, ne pose pas le même problème.
    const m =
      "Vous avez arrêté les collabs influenceurs en 2025. Un choix rare. On a documenté ce virage chez trois maisons, je vous envoie la synthèse si ça vous parle. Jeanne";

    expect(defautsDuMessage(m)).not.toContain("finit_par_question");
  });

  it("signale le compliment retourné", () => {
    // « Le luxe canadien a les bons codes, mais rarement un point de vue irremplaçable. »
    // Dire à une directrice marketing que son marché est médiocre, puis lui demander de se
    // justifier.
    for (const m of [
      "Le luxe canadien a les bons codes, mais rarement un point de vue irremplaçable. Jeanne",
      "Belle identité visuelle, mais peu de constance éditoriale. Jeanne",
      "Un positionnement clair, mais sans réelle incarnation. Jeanne",
    ]) {
      expect(defautsDuMessage(m), m).toContain("compliment_retourne");
    }
  });

  it("ne signale PAS un « mais » légitime", () => {
    // Trouvé par mutation : remplacer le motif précis par n'importe quel « mais » ne cassait
    // aucun test, faute d'exemple légitime. Or « mais » est fréquent et souvent élogieux —
    // élargir la règle inonderait l'utilisatrice de faux signalements.
    for (const m of [
      "Vous publiez peu, mais chaque post pèse. Jeanne",
      "Un marché saturé, mais votre angle tient. Jeanne",
      "Discret sur LinkedIn, mais très suivi ailleurs. Jeanne",
    ]) {
      expect(defautsDuMessage(m), m).not.toContain("compliment_retourne");
    }
  });

  it("signale les formules creuses interdites", () => {
    for (const m of [
      "J'ai vu votre profil et je voulais échanger. Jeanne",
      "Je me permets de vous contacter au sujet de votre marque. Jeanne",
      "En tant qu'experte du luxe, je pense pouvoir vous aider. Jeanne",
    ]) {
      expect(defautsDuMessage(m).length, m).toBeGreaterThan(0);
    }
  });

  it("un message vide ne fait pas tomber la fonction", () => {
    for (const m of ["", "   ", null, undefined]) {
      expect(() => defautsDuMessage(m as string), String(m)).not.toThrow();
    }
  });

  it("ne signale pas une question rhétorique suivie d'une réponse", () => {
    const m =
      "Pourquoi si peu de maisons osent le silence ? Parce que c'est mesurable nulle part. On a construit une lecture de ça. Jeanne";

    expect(defautsDuMessage(m)).not.toContain("finit_par_question");
  });
});

describe("incoherenceDeGenre", () => {
  it("détecte un lot où l'expéditrice change de genre", () => {
    // LE défaut trouvé en production : 13 « curieuse » et 1 « curieux ». Le même compte ne
    // peut pas être les deux, et ça se détecte SANS savoir qui est l'expéditrice.
    const lot = [
      "Je suis curieuse de votre approche. Jeanne",
      "Curieuse de savoir comment vous faites. Jeanne",
      "Je suis curieux de votre méthode. Jeanne",
    ];

    const r = incoherenceDeGenre(lot);

    expect(r.incoherent).toBe(true);
    expect(r.masculins).toBe(1);
    expect(r.feminins).toBe(2);
  });

  it("ne signale rien quand le lot est cohérent", () => {
    const lot = ["Curieuse de votre approche. Jeanne", "Ravie de découvrir ça. Jeanne"];

    expect(incoherenceDeGenre(lot).incoherent).toBe(false);
  });

  it("ne signale rien quand aucun message ne se décrit", () => {
    // Le prompt demande d'éviter tout adjectif accordé en genre. Un lot conforme n'a donc
    // ni masculin ni féminin, et ce n'est PAS une incohérence.
    const lot = ["Votre virage de 2025 nous a marqués. Jeanne", "On a documenté ce cas. Jeanne"];

    const r = incoherenceDeGenre(lot);

    expect(r.incoherent).toBe(false);
    expect(r.masculins).toBe(0);
    expect(r.feminins).toBe(0);
  });

  it("ne confond pas le genre de l'expéditrice avec celui du prospect", () => {
    // « Votre approche est intéressante » décrit l'approche, pas l'expéditrice. Sans cette
    // distinction, tout lot serait signalé.
    const lot = ["Votre approche est intéressante. Jeanne", "Curieuse de la suite. Jeanne"];

    expect(incoherenceDeGenre(lot).incoherent).toBe(false);
  });

  it("un lot vide ou d'un seul message ne peut pas être incohérent", () => {
    expect(incoherenceDeGenre([]).incoherent).toBe(false);
    expect(incoherenceDeGenre(["Je suis curieux. Jeanne"]).incoherent).toBe(false);
  });
});
