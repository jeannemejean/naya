import { describe, it, expect } from "vitest";
import {
  lireQualification,
  decisionCampagne,
  VERDICTS,
  type Verdict,
} from "./prospection-qualification";

/**
 * Qualification d'un prospect à partir de son audit.
 *
 * Demande de Jeanne (18 septembre) : « à partir du moment où elle fait l'audit, il faut
 * qu'elle se demande si c'est un prospect intelligent ou non, et du coup est-ce qu'on le
 * garde ou non dans la campagne ».
 *
 * L'audit existe déjà et il est riche — pour CHANEL il connaît la maison, son actionnariat,
 * sa communication délibérément en retrait. Mais rien ne le JUGE : il est écrit, stocké, et
 * sert à rédiger. Les 120 prospects de la production sont tous `discovered`, aucun n'a
 * jamais été qualifié ni écarté.
 */
describe("lireQualification", () => {
  it("lit un verdict complet", () => {
    const q = lireQualification({
      verdict: "retenu",
      raison: "Marque en croissance, communication digitale sous-exploitée.",
      confiance: "haute",
    });

    expect(q).toEqual({
      verdict: "retenu",
      raison: "Marque en croissance, communication digitale sous-exploitée.",
      confiance: "haute",
    });
  });

  it("accepte les trois verdicts", () => {
    for (const v of VERDICTS) {
      expect(lireQualification({ verdict: v, raison: "r", confiance: "haute" })?.verdict).toBe(v);
    }
  });

  it("refuse un verdict inconnu", () => {
    // Bug visé : accepter « peut-être » ou « RETENU » et le traiter ensuite comme un verdict
    // valide, donc agir sur une valeur que personne n'a prévue.
    for (const v of ["peut-etre", "RETENU", "", "rejected", null, 42]) {
      expect(lireQualification({ verdict: v, raison: "r", confiance: "haute" }), String(v)).toBeNull();
    }
  });

  it("refuse un verdict SANS raison", () => {
    // LE test. Un prospect écarté sans motif est un prospect perdu sans recours : Jeanne ne
    // peut ni comprendre ni corriger. La raison n'est pas décorative, elle est la condition
    // pour qu'un tri automatique reste contestable.
    for (const r of ["", "   ", null, undefined, 42]) {
      expect(
        lireQualification({ verdict: "ecarte", raison: r, confiance: "haute" }),
        `raison ${String(r)}`,
      ).toBeNull();
    }
  });

  it("une confiance absente ou inconnue vaut BASSE", () => {
    // Prudence : en l'absence d'information, on ne prête pas au modèle une assurance qu'il
    // n'a pas exprimée. La confiance basse protège, elle ne coûte qu'une relecture.
    for (const c of [undefined, null, "enorme", ""]) {
      expect(
        lireQualification({ verdict: "ecarte", raison: "hors cible", confiance: c })?.confiance,
        `confiance ${String(c)}`,
      ).toBe("basse");
    }
  });

  it("une réponse illisible ne renvoie rien, sans lever", () => {
    for (const brut of [null, undefined, "texte", 42, [], {}]) {
      expect(() => lireQualification(brut as any), String(brut)).not.toThrow();
      expect(lireQualification(brut as any), String(brut)).toBeNull();
    }
  });
});

describe("decisionCampagne", () => {
  const q = (verdict: Verdict, confiance: "haute" | "moyenne" | "basse" = "haute") => ({
    verdict,
    raison: "une raison",
    confiance,
  });

  it("un prospect retenu reste dans la campagne", () => {
    expect(decisionCampagne(q("retenu"))).toBe("garder");
  });

  it("un prospect écarté AVEC confiance haute est retiré", () => {
    expect(decisionCampagne(q("ecarte", "haute"))).toBe("retirer");
  });

  it("un prospect écarté avec une confiance FAIBLE est signalé, PAS retiré", () => {
    // LE test du lot. Écarter sur une intuition faible, c'est perdre un client possible sans
    // que personne ne le sache. Le doute remonte à l'humaine — c'est le même principe que la
    // barrière de validation : Naya prépare, Jeanne décide.
    expect(decisionCampagne(q("ecarte", "basse"))).toBe("signaler");
    expect(decisionCampagne(q("ecarte", "moyenne"))).toBe("signaler");
  });

  it("un prospect à attention particulière est toujours signalé", () => {
    // Le cas CHANEL : pas un mauvais prospect, un prospect qui demande une autre approche.
    for (const c of ["haute", "moyenne", "basse"] as const) {
      expect(decisionCampagne(q("attention_particuliere", c)), `confiance ${c}`).toBe("signaler");
    }
  });

  it("une qualification ABSENTE laisse le prospect tranquille", () => {
    // `null` = jamais qualifié. Ce n'est PAS « écarté ». Un audit non fait, un appel raté, un
    // prospect antérieur au dispositif : aucun ne justifie de retirer quelqu'un d'une campagne.
    expect(decisionCampagne(null)).toBe("indecis");
    expect(decisionCampagne(undefined)).toBe("indecis");
  });

  it("aucun chemin ne retire un prospect sans verdict explicite et confiant", () => {
    // Propriété d'ensemble : « retirer » n'est atteignable que par ecarte + haute.
    const retraits: string[] = [];
    for (const v of [...VERDICTS, "inconnu" as Verdict]) {
      for (const c of ["haute", "moyenne", "basse", "bizarre" as any] as const) {
        if (decisionCampagne({ verdict: v, raison: "r", confiance: c }) === "retirer") {
          retraits.push(`${v}/${c}`);
        }
      }
    }
    expect(retraits).toEqual(["ecarte/haute"]);
  });
});
