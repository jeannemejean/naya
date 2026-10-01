import { describe, it, expect } from "vitest";
import {
  PROMPT_EXTRACTION, construireMessageExtraction, parsePostsExtraits,
  resoudreDate, mesurerCouverture, comblerChamps, MAX_CARACTERES,
  plateformeMajoritaire, PLATEFORME_PAR_DEFAUT,
} from "./parse";

describe("parsePostsExtraits", () => {
  it("lit un tableau de posts entouré de bavardage", () => {
    const raw = `Voici ce que j'ai trouvé :
[{"titre":"A","corps":"corps a","plateforme":"linkedin","type":null,"pilier":null,"objectif":null,"date":"2026-10-06"}]
Fin.`;
    const posts = parsePostsExtraits(raw);
    expect(posts).toHaveLength(1);
    expect(posts![0].titre).toBe("A");
    expect(posts![0].plateforme).toBe("linkedin");
    expect(posts![0].type).toBeNull();
  });

  it("écarte un post sans titre ou sans corps, et garde les autres", () => {
    const raw = `[{"titre":"A","corps":"a"},{"titre":"","corps":"b"},{"titre":"C"},{"titre":"D","corps":"d"}]`;
    const posts = parsePostsExtraits(raw);
    expect(posts!.map((p) => p.titre)).toEqual(["A", "D"]);
  });

  it("rend null sur un JSON illisible", () => {
    expect(parsePostsExtraits(`[{"titre":`)).toBeNull();
  });

  it("rend null quand la réponse n'est pas un tableau", () => {
    expect(parsePostsExtraits(`{"titre":"A","corps":"a"}`)).toBeNull();
  });

  it("rend null sur une réponse vide", () => {
    expect(parsePostsExtraits("")).toBeNull();
  });

  it("rend un tableau vide quand le modèle n'a rien trouvé", () => {
    expect(parsePostsExtraits("[]")).toEqual([]);
  });
});

describe("resoudreDate", () => {
  const aujourdhui = new Date("2026-10-01T00:00:00");

  it("accepte une date ISO réelle", () => {
    const d = resoudreDate("2026-10-06", aujourdhui);
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(6);
  });

  it("rend null sur null — l'absence de date reste une absence", () => {
    expect(resoudreDate(null, aujourdhui)).toBeNull();
  });

  it("rend null sur une expression non résolue par le modèle", () => {
    expect(resoudreDate("semaine du 12", aujourdhui)).toBeNull();
    expect(resoudreDate("lundi 6", aujourdhui)).toBeNull();
  });

  it("rend null sur un jour qui n'existe pas", () => {
    expect(resoudreDate("2026-02-30", aujourdhui)).toBeNull();
    expect(resoudreDate("2026-13-01", aujourdhui)).toBeNull();
  });

  it("vérifie un vrai calendrier, années bissextiles comprises", () => {
    // 2028 est bissextile, 2027 ne l'est pas. Ce couple prouve que le garde consulte un
    // calendrier réel et ne se contente pas de borner les composants.
    expect(resoudreDate("2028-02-29", new Date("2027-06-01T00:00:00"))).toBeInstanceOf(Date);
    expect(resoudreDate("2027-02-29", new Date("2027-01-01T00:00:00"))).toBeNull();
  });

  it("rend null sur une date hors des bornes plausibles", () => {
    expect(resoudreDate("1970-01-01", aujourdhui)).toBeNull();
    expect(resoudreDate("2199-01-01", aujourdhui)).toBeNull();
  });

  it("accepte une date un peu dans le passé, qu'on peut légitimement vouloir", () => {
    expect(resoudreDate("2026-09-15", aujourdhui)).toBeInstanceOf(Date);
  });
});

describe("mesurerCouverture", () => {
  it("rend le rapport entre le texte extrait et le texte collé", () => {
    const posts = [
      { titre: "ab", corps: "cdef", plateforme: null, type: null, pilier: null, objectif: null, date: null },
    ];
    expect(mesurerCouverture(posts, "a".repeat(12))).toBeCloseTo(0.5, 5);
  });

  it("rend 0 sur un texte vide, sans division par zéro", () => {
    expect(mesurerCouverture([], "")).toBe(0);
  });

  it("peut dépasser 1 quand le modèle a réécrit au lieu d'extraire", () => {
    const posts = [
      { titre: "x".repeat(50), corps: "y".repeat(50), plateforme: null, type: null, pilier: null, objectif: null, date: null },
    ];
    expect(mesurerCouverture(posts, "z".repeat(10))).toBeGreaterThan(1);
  });
});

describe("comblerChamps", () => {
  const nu = { titre: "T", corps: "C", plateforme: null, type: null, pilier: null, objectif: null, date: null };

  it("comble la plateforme et le type, et les déclare", () => {
    const r = comblerChamps(nu, "instagram");
    expect(r.valeurs.platform).toBe("instagram");
    expect(r.valeurs.contentType).toBe("post");
    expect(r.deduits).toEqual(expect.arrayContaining(["platform", "contentType"]));
  });

  it("laisse le pilier et l'objectif VIDES sans les déclarer déduits", () => {
    const r = comblerChamps(nu, "instagram");
    expect(r.valeurs.pillar).toBe("");
    expect(r.valeurs.goal).toBe("");
    expect(r.deduits).not.toContain("pillar");
    expect(r.deduits).not.toContain("goal");
  });

  it("ne déclare rien quand le texte a tout dit", () => {
    const r = comblerChamps(
      { titre: "T", corps: "C", plateforme: "linkedin", type: "carousel", pilier: "coulisses", objectif: "engagement", date: null },
      "instagram",
    );
    expect(r.deduits).toEqual([]);
    expect(r.valeurs.platform).toBe("linkedin");
    expect(r.valeurs.pillar).toBe("coulisses");
  });
});

describe("le prompt", () => {
  it("ordonne d'extraire et non de réécrire", () => {
    expect(PROMPT_EXTRACTION.toLowerCase()).toContain("extrai");
    expect(PROMPT_EXTRACTION).toMatch(/ne réécris pas|sans réécrire|pas de réécriture/i);
  });

  it("exige null plutôt qu'une valeur devinée", () => {
    expect(PROMPT_EXTRACTION).toContain("null");
  });

  it("injecte la date du jour dans le message", () => {
    const msg = construireMessageExtraction("mon calendrier", new Date("2026-10-01T00:00:00"));
    expect(msg).toContain("2026-10-01");
    expect(msg).toContain("mon calendrier");
  });
});

describe("plateformeMajoritaire", () => {
  it("rend la plateforme la plus fréquente", () => {
    expect(plateformeMajoritaire(["instagram", "linkedin", "instagram"])).toBe("instagram");
  });

  it("départage une égalité par ordre alphabétique, donc de façon déterministe", () => {
    // Sans départage stable, deux imports identiques combleraient différemment.
    expect(plateformeMajoritaire(["tiktok", "instagram"])).toBe("instagram");
    expect(plateformeMajoritaire(["instagram", "tiktok"])).toBe("instagram");
  });

  it("rend linkedin quand la marque n'a aucun contenu", () => {
    expect(plateformeMajoritaire([])).toBe(PLATEFORME_PAR_DEFAUT);
    expect(PLATEFORME_PAR_DEFAUT).toBe("linkedin");
  });

  it("ignore les valeurs vides sans les compter comme une plateforme", () => {
    expect(plateformeMajoritaire(["", "", "tiktok"])).toBe("tiktok");
  });
});

describe("la limite de taille", () => {
  it("vaut 40 000 caractères", () => {
    expect(MAX_CARACTERES).toBe(40000);
  });
});
