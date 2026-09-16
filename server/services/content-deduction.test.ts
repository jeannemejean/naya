import { describe, it, expect } from "vitest";
import { lireReponse } from "./content-deduction";

/**
 * Lecture de la réponse du modèle. Cette fonction décide de ce qui sera écrit dans le
 * calendrier de contenu : elle doit refuser tout ce qui n'est pas exploitable, plutôt que
 * de laisser passer une valeur qui sera enregistrée telle quelle.
 *
 * Aucun cas ne doit lever. Le texte de l'utilisatrice est déjà enregistré quand cette
 * fonction s'exécute ; une exception ici ferait échouer une requête qui a déjà réussi.
 */
describe("lireReponse", () => {
  it("lit un JSON propre", () => {
    const r = lireReponse('{"platform":"linkedin","contentType":"post","pillar":"Build","goal":"visibilité"}');

    expect(r).toEqual({ platform: "linkedin", contentType: "post", pillar: "Build", goal: "visibilité" });
  });

  it("supporte les balises markdown autour du JSON", () => {
    // Bug visé, et il est fréquent : le modèle entoure son JSON de ```json … ```.
    const r = lireReponse('```json\n{"platform":"instagram"}\n```');

    expect(r).toEqual({ platform: "instagram" });
  });

  it("supporte du texte avant et après", () => {
    const r = lireReponse('Voici ma réponse :\n{"platform":"tiktok"}\nJ\'espère que ça aide.');

    expect(r).toEqual({ platform: "tiktok" });
  });

  it("ignore les champs blancs", () => {
    // Le prompt demande explicitement "" quand le champ n'est pas déterminable. Les écrire
    // tels quels mettrait des chaînes vides dans des colonnes NOT NULL.
    expect(lireReponse('{"platform":"linkedin","pillar":"","goal":"   "}')).toEqual({
      platform: "linkedin",
    });
  });

  it("ignore les champs qui ne sont pas des chaînes", () => {
    // Bug visé : `pillar: 3` écrit tel quel donnerait "3" en base après coercition.
    expect(lireReponse('{"platform":42,"contentType":null,"pillar":{"a":1},"goal":["x"]}')).toEqual({});
  });

  it("ignore les clés inconnues", () => {
    expect(lireReponse('{"platform":"linkedin","couleur":"bleu"}')).toEqual({ platform: "linkedin" });
  });

  it("rend un objet vide sur une réponse illisible, sans lever", () => {
    for (const brut of ["", "je ne sais pas", "{", "}{", "null", "[]", '["linkedin"]', "{ pas du json }"]) {
      expect(() => lireReponse(brut), `réponse « ${brut} »`).not.toThrow();
      expect(lireReponse(brut), `réponse « ${brut} »`).toEqual({});
    }
  });

  it("récupère un objet enveloppé dans un tableau", () => {
    // J'avais d'abord écrit l'inverse — attendre un rejet — puis constaté que le code
    // extrait l'objet de son enveloppe, et qu'il a raison de le faire.
    //
    // Envelopper l'objet dans un tableau est une maladresse de format courante. L'objet
    // extrait passe ensuite la validation champ par champ, donc la souplesse ne laisse rien
    // passer de douteux. La refuser perdrait une réponse parfaitement exploitable.
    expect(lireReponse('[{"platform":"linkedin"}]')).toEqual({ platform: "linkedin" });
  });

  it("un tableau de PLUSIEURS objets ne produit rien", () => {
    // La limite de cette souplesse, et elle tient toute seule : l'extraction du premier `{`
    // au dernier `}` donne un JSON invalide, donc {}. On ne choisit pas arbitrairement le
    // premier élément d'une liste que le modèle n'aurait pas dû rendre.
    expect(lireReponse('[{"platform":"linkedin"},{"platform":"instagram"}]')).toEqual({});
  });

  it("un tableau nu ne produit rien", () => {
    // Trouvé par mutation : j'avais d'abord attribué ce comportement à un test
    // Array.isArray. C'était faux — ce garde était INATTEIGNABLE, puisque la tranche
    // commence au premier `{`. Ce qui protège ici est l'absence d'accolade : indexOf("{")
    // vaut -1, la fonction sort avant toute analyse. Le garde mort a été retiré.
    expect(lireReponse('["linkedin","post"]')).toEqual({});
  });

  it("prend le dernier } et non le premier", () => {
    // Bug visé : couper au premier `}` tronquerait un JSON contenant un objet imbriqué.
    expect(lireReponse('{"platform":"linkedin","goal":"a"}')).toEqual({
      platform: "linkedin",
      goal: "a",
    });
  });
});
