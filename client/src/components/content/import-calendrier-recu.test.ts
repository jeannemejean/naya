import { describe, it, expect } from "vitest";
import { construireRecu, type ReponseImportCalendrier } from "./import-calendrier-recu";

function posts(nDates: number, nReserve: number) {
  const datees = Array.from({ length: nDates }, () => ({ scheduledFor: "2026-10-10T00:00:00.000Z" }));
  const reservees = Array.from({ length: nReserve }, () => ({ scheduledFor: null }));
  return [...datees, ...reservees];
}

// `new Date(annee, mois0, jour)` — composants LOCAUX, jamais une chaîne ISO en UTC : le
// commentaire de `resoudreDate` (server/services/content-import/parse.ts) montre qu'un
// minuit UTC peut reculer d'un jour une fois reformaté en heure locale. Un test qui
// tomberait dans ce piège en comparant une date affichée conclurait à une date "fausse"
// là où `ligneCollision` a fait son travail correctement.
const reponseExemple: ReponseImportCalendrier = {
  posts: posts(9, 5),
  ignores: 2,
  couverture: 85,
  reecrit: false,
  tronque: true,
  collisions: [
    { marque: "Agence JMD", scheduledFor: new Date(2026, 9, 12), pourquoi: "même angle sur le lancement de l'offre premium" },
    { marque: "Studio X", scheduledFor: new Date(2026, 9, 15), pourquoi: "même témoignage client repris" },
  ],
};

describe("construireRecu — l'exemple complet du brief, mot pour mot", () => {
  it("rend exactement les sept lignes attendues, dans l'ordre — une ligne PAR recoupement, avec la date, la marque et le pourquoi", () => {
    expect(construireRecu(reponseExemple)).toEqual([
      "14 posts créés.",
      "Ton texte a été repris à environ 85 %.",
      "9 sont datés, 5 sont en réserve.",
      "2 posts étaient déjà présents, ignorés.",
      "Un contenu déjà programmé le 12 octobre sur « Agence JMD » couvre un angle proche : même angle sur le lancement de l'offre premium",
      "Un contenu déjà programmé le 15 octobre sur « Studio X » couvre un angle proche : même témoignage client repris",
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

  it("un recoupement SANS date affiche la marque sans lieu temporel", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [{ marque: "Agence JMD", scheduledFor: null, pourquoi: "même angle" }],
    };
    expect(construireRecu(reponse)).toContain(
      "Un contenu déjà programmé sur « Agence JMD » couvre un angle proche : même angle",
    );
  });
});

describe("construireRecu — une ligne PAR recoupement, jamais un simple compte agrégé", () => {
  it("elle sait désormais LESQUELS recoupent : chaque ligne porte sa propre date, sa propre marque et son propre pourquoi", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(2, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [
        { marque: "Agence JMD", scheduledFor: new Date(2026, 9, 6), pourquoi: "pourquoi A" },
        { marque: "Studio X", scheduledFor: new Date(2026, 9, 9), pourquoi: "pourquoi B" },
      ],
    };
    const lignes = construireRecu(reponse);
    expect(lignes).toContain("Un contenu déjà programmé le 6 octobre sur « Agence JMD » couvre un angle proche : pourquoi A");
    expect(lignes).toContain("Un contenu déjà programmé le 9 octobre sur « Studio X » couvre un angle proche : pourquoi B");
  });

  it("plafonne à 3 lignes de détail, et dit le nombre RÉEL de recoupements restants", () => {
    const collisions = Array.from({ length: 5 }, (_, i) => ({
      marque: `Marque ${i + 1}`,
      scheduledFor: new Date(2026, 9, 1 + i),
      pourquoi: `raison ${i + 1}`,
    }));
    const reponse: ReponseImportCalendrier = {
      posts: posts(5, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions,
    };
    const lignes = construireRecu(reponse);
    const lignesDetail = lignes.filter((l) => l.startsWith("Un contenu déjà programmé"));
    expect(lignesDetail).toHaveLength(3);
    expect(lignes).toContain("Et 2 autres recoupements du même type.");
  });

  it("le compte restant est singulier à 1, et calculé sur les recoupements AFFICHABLES (pourquoi non vide), pas sur le total brut", () => {
    const collisions = [
      ...Array.from({ length: 3 }, (_, i) => ({
        marque: `Marque ${i + 1}`,
        scheduledFor: new Date(2026, 9, 1 + i),
        pourquoi: `raison ${i + 1}`,
      })),
      { marque: "Masquée (pourquoi vide)", scheduledFor: new Date(2026, 9, 20), pourquoi: "" },
      { marque: "La vraie quatrième", scheduledFor: new Date(2026, 9, 21), pourquoi: "raison 4" },
    ];
    const reponse: ReponseImportCalendrier = {
      posts: posts(5, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions,
    };
    const lignes = construireRecu(reponse);
    expect(lignes).toContain("Et 1 autre recoupement du même type.");
    expect(lignes.join("\n")).not.toMatch(/Masquée/);
  });

  // Comme `messageCollision` (content-calendar.tsx) : jamais une phrase à moitié vraie.
  it("n'affiche JAMAIS un recoupement dont le pourquoi est vide, et ne le compte pas non plus dans le compte restant", () => {
    const reponse: ReponseImportCalendrier = {
      posts: posts(1, 0),
      ignores: 0,
      couverture: 100,
      reecrit: false,
      tronque: false,
      collisions: [{ marque: "Agence JMD", scheduledFor: new Date(2026, 9, 6), pourquoi: "   " }],
    };
    const lignes = construireRecu(reponse);
    expect(lignes.join("\n")).not.toMatch(/Agence JMD/);
    expect(lignes.join("\n")).not.toMatch(/recoupement/);
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
