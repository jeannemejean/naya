import { describe, it, expect } from "vitest";
import { construireRecu, type ReponseImportCalendrier } from "./import-calendrier-recu";

function posts(nDates: number, nReserve: number) {
  const datees = Array.from({ length: nDates }, () => ({ scheduledFor: "2026-10-10T00:00:00.000Z" }));
  const reservees = Array.from({ length: nReserve }, () => ({ scheduledFor: null }));
  return [...datees, ...reservees];
}

const reponseExemple: ReponseImportCalendrier = {
  posts: posts(9, 5),
  ignores: 2,
  couverture: 85,
  reecrit: false,
  tronque: true,
  collisions: [
    { marque: "Agence JMD" },
    { marque: "Agence JMD" },
  ],
};

describe("construireRecu — l'exemple complet du brief, mot pour mot", () => {
  it("rend exactement les six lignes attendues, dans l'ordre", () => {
    expect(construireRecu(reponseExemple)).toEqual([
      "14 posts créés.",
      "Ton texte a été repris à environ 85 %.",
      "9 sont datés, 5 sont en réserve.",
      "2 posts étaient déjà présents, ignorés.",
      "2 recoupent du contenu déjà programmé sur Agence JMD.",
      "Ton texte était trop long pour un seul passage : une partie n'a pas été lue.",
    ]);
  });
});

describe("construireRecu — aucune ligne à zéro", () => {
  const sansRien: ReponseImportCalendrier = {
    posts: posts(9, 5),
    ignores: 0,
    couverture: 85,
    reecrit: false,
    tronque: false,
    collisions: [],
  };

  it("omet la ligne des ignorés quand ignores vaut 0", () => {
    expect(construireRecu(sansRien).join("\n")).not.toMatch(/ignoré/);
  });

  it("omet la ligne des collisions quand collisions est vide", () => {
    expect(construireRecu(sansRien).join("\n")).not.toMatch(/recoupe/);
  });

  it("omet la ligne de troncature quand tronque est faux", () => {
    expect(construireRecu(sansRien).join("\n")).not.toMatch(/trop long/);
  });

  it("ne rend que les trois premières lignes dans ce cas", () => {
    expect(construireRecu(sansRien)).toEqual([
      "14 posts créés.",
      "Ton texte a été repris à environ 85 %.",
      "9 sont datés, 5 sont en réserve.",
    ]);
  });
});

describe("construireRecu — couverture et posts créés sont DEUX faits, jamais soudés", () => {
  it("une couverture élevée du texte lu n'implique pas que les posts créés en couvrent autant — cas où la plupart des posts extraits sont des doublons ignorés", () => {
    // 16 posts lus par le modèle (couverture mesurée sur le texte LU), dont 14 étaient
    // déjà présents et ignorés : seuls 2 posts sont réellement créés. Souder les deux
    // faits en une phrase laisserait croire que les 2 posts créés couvrent 95 % du
    // texte collé, ce qui serait faux.
    const reponse: ReponseImportCalendrier = {
      posts: posts(2, 0),
      ignores: 14,
      couverture: 95,
      reecrit: false,
      tronque: false,
      collisions: [],
    };
    const lignes = construireRecu(reponse);
    expect(lignes[0]).toBe("2 posts créés.");
    expect(lignes[1]).toBe("Ton texte a été repris à environ 95 %.");
    // Aucune LIGNE (prise isolément) ne doit affirmer que les posts CRÉÉS couvrent
    // 95 % de quoi que ce soit — les deux faits ne sont jamais soudés dans une même
    // phrase, même si les deux lignes se suivent dans l'affichage.
    expect(lignes.some((l) => /créés/.test(l) && /%/.test(l))).toBe(false);
  });
});

describe("construireRecu — accords singulier/pluriel", () => {
  it("1 post créé (singulier)", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [],
    };
    expect(construireRecu(reponse)[0]).toBe("1 post créé.");
    expect(construireRecu(reponse)[1]).toBe("Ton texte a été repris à environ 100 %.");
  });

  it("1 est daté, 1 est en réserve (singulier des deux côtés)", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 1),
      ignores: 0,
      couverture: 50,
      reecrit: false,
      tronque: false,
      collisions: [],
    };
    expect(construireRecu(reponse)[2]).toBe("1 est daté, 1 est en réserve.");
  });

  it("1 post était déjà présent, ignoré (singulier)", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 1,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [],
    };
    expect(construireRecu(reponse)).toContain("1 post était déjà présent, ignoré.");
  });

  it("1 recoupe du contenu déjà programmé sur ... (singulier)", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [{ marque: "Agence JMD" }],
    };
    expect(construireRecu(reponse)).toContain("1 recoupe du contenu déjà programmé sur Agence JMD.");
  });
});

describe("construireRecu — plusieurs marques distinctes dans les collisions", () => {
  it("les énumère avec un « et » final, sans doublon", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(2, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [
        { marque: "Agence JMD" },
        { marque: "Studio X" },
        { marque: "Agence JMD" },
      ],
    };
    expect(construireRecu(reponse)).toContain(
      "3 recoupent du contenu déjà programmé sur Agence JMD et Studio X.",
    );
  });
});

describe("construireRecu — aucun post trouvé", () => {
  it("affiche les deux premières lignes à zéro (ce ne sont pas des lignes conditionnelles) mais omet la répartition datés/réserve", () => {
    const reponse: ReponseImportCalendrier = {
      posts: [],
      ignores: 0,
      couverture: 0,
      reecrit: false,
      tronque: false,
      collisions: [],
    };
    expect(construireRecu(reponse)).toEqual([
      "0 posts créés.",
      "Ton texte a été repris à environ 0 %.",
    ]);
  });
});

describe("construireRecu — signal de réécriture", () => {
  it("affiche la ligne de réécriture quand reecrit est vrai, avant la ligne de troncature", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 0,
      couverture: 100,
      reecrit: true,
      tronque: true,
      collisions: [],
    };
    const lignes = construireRecu(reponse);
    expect(lignes).toContain(
      "Naya a probablement reformulé ton texte au lieu de le recopier : vérifie quelques posts.",
    );
    const iReecrit = lignes.indexOf(
      "Naya a probablement reformulé ton texte au lieu de le recopier : vérifie quelques posts.",
    );
    const iTronque = lignes.indexOf(
      "Ton texte était trop long pour un seul passage : une partie n'a pas été lue.",
    );
    expect(iReecrit).toBeLessThan(iTronque);
  });

  it("omet la ligne de réécriture quand reecrit est faux", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [],
    };
    expect(construireRecu(reponse).join("\n")).not.toMatch(/reformulé/);
  });
});
