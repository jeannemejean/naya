import { describe, it, expect } from "vitest";
import { extraireJson } from "./prospection-qualify-call";
import { lireQualification, decisionCampagne } from "./prospection-qualification";

/**
 * Lecture de la réponse du modèle de qualification, bout à bout.
 *
 * `extraireJson` est le seul endroit qui touche au texte brut. Une extraction trop
 * permissive livrerait à `lireQualification` un objet inattendu ; trop stricte, elle
 * perdrait une réponse exploitable et le prospect resterait « non qualifié ».
 */
describe("extraireJson", () => {
  it("lit un JSON propre", () => {
    expect(extraireJson('{"verdict":"retenu","raison":"r","confiance":"haute"}')).toEqual({
      verdict: "retenu",
      raison: "r",
      confiance: "haute",
    });
  });

  it("supporte les balises markdown et le texte autour", () => {
    const brut = 'Voici mon verdict :\n```json\n{"verdict":"ecarte","raison":"hors cible"}\n```\nVoilà.';
    expect(extraireJson(brut)).toEqual({ verdict: "ecarte", raison: "hors cible" });
  });

  it("rend null sur tout ce qui n'est pas exploitable, sans lever", () => {
    for (const brut of ["", "je ne sais pas", "{", "}{", "{ pas du json }", null as any]) {
      expect(() => extraireJson(brut), `« ${brut} »`).not.toThrow();
      expect(extraireJson(brut), `« ${brut} »`).toBeNull();
    }
  });
});

/**
 * La chaîne complète : texte du modèle → verdict → décision de campagne.
 *
 * Ces tests existent parce que les trois pièces sont correctes séparément et pourraient
 * quand même mal s'enchaîner. Ce qui compte n'est pas qu'une fonction dise non, c'est qu'un
 * prospect ne soit pas retiré à tort au bout de la chaîne.
 */
describe("du texte brut à la décision", () => {
  const bout = (brut: string) => decisionCampagne(lireQualification(extraireJson(brut)));

  it("un écarté confiant retire", () => {
    expect(
      bout('{"verdict":"ecarte","raison":"Ne fait pas de communication digitale","confiance":"haute"}'),
    ).toBe("retirer");
  });

  it("un écarté hésitant NE retire PAS", () => {
    expect(bout('{"verdict":"ecarte","raison":"Peu d\'informations","confiance":"moyenne"}')).toBe(
      "signaler",
    );
  });

  it("une réponse illisible ne retire JAMAIS", () => {
    // LE test de la chaîne. Un modèle qui bafouille ne doit pas faire disparaître un
    // prospect de la campagne. `null` veut dire « pas qualifié », pas « écarté ».
    for (const brut of ["", "erreur 500", "{}", '{"verdict":"ecarte"}']) {
      expect(bout(brut), `« ${brut} »`).toBe("indecis");
    }
  });

  it("un écarté SANS raison ne retire pas non plus", () => {
    // La raison est la condition, pas une décoration : sans elle le verdict est rejeté a la
    // lecture, donc la décision retombe sur « indécis ».
    expect(bout('{"verdict":"ecarte","raison":"","confiance":"haute"}')).toBe("indecis");
  });

  it("le cas CHANEL remonte à l'utilisatrice", () => {
    expect(
      bout(
        '{"verdict":"attention_particuliere","raison":"Communication volontairement en retrait","confiance":"haute"}',
      ),
    ).toBe("signaler");
  });
});
