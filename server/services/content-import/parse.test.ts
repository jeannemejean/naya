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

describe("parsePostsExtraits — réponse tronquée (pas de \"]\" fermant)", () => {
  it("récupère les objets COMPLETS avant la coupure, et ignore celui coupé en plein milieu", () => {
    const raw =
      '[{"titre":"Premier","corps":"Corps du premier, complet.","plateforme":null,"type":null,"pilier":null,"objectif":null,"date":null},' +
      '{"titre":"Deuxième","corps":"Corps du deuxième, complet aussi.","plateforme":null,"type":null,"pilier":null,"objectif":null,"date":null},' +
      '{"titre":"Troisième coupé","corps":"Ce corps est interrompu en pl';
    const posts = parsePostsExtraits(raw);
    expect(posts).not.toBeNull();
    expect(posts!.map((p) => p.titre)).toEqual(["Premier", "Deuxième"]);
  });

  it("rend null quand la coupure survient DANS le tout premier objet — rien n'est récupérable", () => {
    expect(parsePostsExtraits(`[{"titre":`)).toBeNull();
    expect(parsePostsExtraits(`[{"titre":"A","corps":"un corps qui se fait coup`)).toBeNull();
  });

  it("rend null sur un tableau tronqué juste après l'ouverture, sans aucun objet", () => {
    expect(parsePostsExtraits("[")).toBeNull();
  });

  it("une accolade ou une guillemet échappée À L'INTÉRIEUR d'une chaîne ne perturbe pas le comptage de profondeur", () => {
    const raw =
      '[{"titre":"Avec accolade","corps":"Un corps qui mentionne { ceci } et une guillemet \\" échappée, complet.","plateforme":null,"type":null,"pilier":null,"objectif":null,"date":null},' +
      '{"titre":"Coupé ensuite","corps":"interrom';
    const posts = parsePostsExtraits(raw);
    expect(posts).not.toBeNull();
    expect(posts).toHaveLength(1);
    expect(posts![0].corps).toContain("{ ceci }");
    expect(posts![0].corps).toContain('"');
  });

  it("salvage un objet complet même sans aucun objet AVANT lui coupé en second", () => {
    // Un seul post dans la réponse, entier, puis la coupure arrive juste après —
    // aucune virgule, aucun second objet amorcé.
    const raw = '[{"titre":"Seul post","corps":"Corps entier.","plateforme":null,"type":null,"pilier":null,"objectif":null,"date":null}';
    const posts = parsePostsExtraits(raw);
    expect(posts).toHaveLength(1);
    expect(posts![0].titre).toBe("Seul post");
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

  it("verrouille les bornes de plausibilité : 365j passé et 730j futur (inclusif)", () => {
    // Les bornes sont inclusives : le code utilise < et >, pas <= et >=
    const toLocalDateStr = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    // Côté passé : 365 jours avant (dernier jour accepté)
    const date365DaysAgo = new Date(aujourdhui.getTime() - 365 * 86400000);
    const str365 = toLocalDateStr(date365DaysAgo);
    expect(resoudreDate(str365, aujourdhui)).toBeInstanceOf(Date);

    // Côté passé : 366 jours avant (premier jour rejeté)
    const date366DaysAgo = new Date(aujourdhui.getTime() - 366 * 86400000);
    const str366 = toLocalDateStr(date366DaysAgo);
    expect(resoudreDate(str366, aujourdhui)).toBeNull();

    // Côté futur : 730 jours après (dernier jour accepté)
    const date730DaysLater = new Date(aujourdhui.getTime() + 730 * 86400000);
    const str730 = toLocalDateStr(date730DaysLater);
    expect(resoudreDate(str730, aujourdhui)).toBeInstanceOf(Date);

    // Côté futur : 731 jours après (premier jour rejeté)
    const date731DaysLater = new Date(aujourdhui.getTime() + 731 * 86400000);
    const str731 = toLocalDateStr(date731DaysLater);
    expect(resoudreDate(str731, aujourdhui)).toBeNull();
  });
});

describe("mesurerCouverture", () => {
  it("rend le rapport entre le CORPS extrait et le texte collé", () => {
    const posts = [
      { titre: "ab", corps: "cdef", plateforme: null, type: null, pilier: null, objectif: null, date: null },
    ];
    expect(mesurerCouverture(posts, "a".repeat(8))).toBeCloseTo(0.5, 5);
  });

  it("ignore le titre — il est SYNTHÉTISÉ par le modèle, pas recopié du texte, donc il ne doit jamais gonfler la mesure", () => {
    const posts = [
      // Un titre énorme à côté d'un corps minuscule : si le titre entrait dans le
      // calcul, la couverture serait proche de 1 ; en ne comptant que le corps, elle
      // doit rester proche de 0.
      { titre: "x".repeat(500), corps: "y".repeat(5), plateforme: null, type: null, pilier: null, objectif: null, date: null },
    ];
    expect(mesurerCouverture(posts, "z".repeat(500))).toBeCloseTo(0.01, 5);
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
    // Teste la consigne elle-même, pas un jeton qui pourrait venir du squelette JSON d'exemple
    expect(PROMPT_EXTRACTION).toContain("N'invente JAMAIS une valeur plausible");
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
