import { describe, it, expect } from "vitest";
import {
  construireTexteConfirmation,
  construireMessageSucces,
  texteAvertissementRaisonVide,
  messageEchecRejet,
  messageEchecApercu,
  type ApercuRejet,
  type ResultatRejet,
} from "./campaigns-rejet";

function apercu(partial: Partial<ApercuRejet>): ApercuRejet {
  return {
    contenusGardes: 0,
    contenusPartants: 0,
    tachesGardees: 0,
    tachesPartantes: 0,
    articulationsRompues: [],
    prospectionLiee: [],
    prospectsAArchiver: 0,
    ...partial,
  };
}

describe("construireTexteConfirmation — l'exemple complet du brief, mot pour mot", () => {
  it("rend exactement les quatre lignes attendues, dans l'ordre", () => {
    const resultat = construireTexteConfirmation(
      apercu({
        contenusGardes: 3,
        contenusPartants: 9,
        tachesGardees: 5,
        tachesPartantes: 3,
        articulationsRompues: [{ campagneId: 1, campagneNom: "Make Brands Unmistakable", marque: "Agence JMD" }],
      }),
    );
    expect(resultat).toEqual([
      "Cette campagne a 12 posts et 8 tâches.",
      "3 posts publiés et 5 tâches faites seront conservés, détachés de la campagne.",
      "9 posts et 3 tâches seront supprimés.",
      "La campagne « Make Brands Unmistakable » sur Agence JMD est articulée avec celle-ci — en la rejetant, cette articulation disparaît.",
    ]);
  });
});

describe("construireTexteConfirmation — aucune ligne à zéro", () => {
  it("omet la ligne des gardés quand les deux comptes sont à zéro", () => {
    const lignes = construireTexteConfirmation(
      apercu({ contenusPartants: 9, tachesPartantes: 3 }),
    );
    expect(lignes.join("\n")).not.toMatch(/conservé/);
  });

  it("omet la ligne des partants quand les deux comptes sont à zéro", () => {
    const lignes = construireTexteConfirmation(
      apercu({ contenusGardes: 3, tachesGardees: 5 }),
    );
    expect(lignes.join("\n")).not.toMatch(/supprimé/);
  });

  it("omet l'en-tête quand la campagne n'a ni post ni tâche", () => {
    const lignes = construireTexteConfirmation(apercu({}));
    expect(lignes).toEqual([]);
  });

  it("n'écrit jamais « 0 » dans une ligne produite", () => {
    const lignes = construireTexteConfirmation(
      apercu({ contenusGardes: 3, contenusPartants: 9, tachesGardees: 0, tachesPartantes: 0 }),
    );
    expect(lignes.join("\n")).not.toMatch(/\b0\b/);
  });

  it("omet le membre de phrase des tâches dans la ligne des partants quand seuls des posts partent", () => {
    const lignes = construireTexteConfirmation(apercu({ contenusPartants: 9 }));
    expect(lignes).toEqual(["Cette campagne a 9 posts.", "9 posts seront supprimés."]);
  });
});

describe("construireTexteConfirmation — accord singulier/pluriel", () => {
  it("un seul post gardé : singulier masculin", () => {
    const lignes = construireTexteConfirmation(apercu({ contenusGardes: 1 }));
    expect(lignes).toEqual([
      "Cette campagne a 1 post.",
      "1 post publié sera conservé, détaché de la campagne.",
    ]);
  });

  it("une seule tâche gardée : singulier féminin", () => {
    const lignes = construireTexteConfirmation(apercu({ tachesGardees: 1 }));
    expect(lignes).toEqual([
      "Cette campagne a 1 tâche.",
      "1 tâche faite sera conservée, détachée de la campagne.",
    ]);
  });

  it("une seule tâche supprimée : singulier féminin, sans post", () => {
    const lignes = construireTexteConfirmation(apercu({ tachesPartantes: 1 }));
    expect(lignes).toEqual(["Cette campagne a 1 tâche.", "1 tâche sera supprimée."]);
  });

  it("plusieurs tâches gardées, aucun post : pluriel féminin", () => {
    const lignes = construireTexteConfirmation(apercu({ tachesGardees: 5 }));
    expect(lignes).toEqual([
      "Cette campagne a 5 tâches.",
      "5 tâches faites seront conservées, détachées de la campagne.",
    ]);
  });

  it("mélange posts + tâches au pluriel : masculin l'emporte (accord français)", () => {
    const lignes = construireTexteConfirmation(apercu({ contenusGardes: 2, tachesGardees: 3 }));
    expect(lignes).toEqual([
      "Cette campagne a 2 posts et 3 tâches.",
      "2 posts publiés et 3 tâches faites seront conservés, détachés de la campagne.",
    ]);
  });
});

describe("construireTexteConfirmation — articulations rompues", () => {
  const articulation = (i: number) => ({ campagneId: i, campagneNom: `Campagne ${i}`, marque: `Marque ${i}` });

  it("aucune ligne quand il n'y a aucune articulation", () => {
    const lignes = construireTexteConfirmation(apercu({ contenusGardes: 1 }));
    expect(lignes.some((l) => l.includes("articulée"))).toBe(false);
  });

  it("une ligne par articulation jusqu'à trois, sans ligne de compte restant", () => {
    const lignes = construireTexteConfirmation(
      apercu({ articulationsRompues: [articulation(1), articulation(2), articulation(3)] }),
    );
    expect(lignes).toEqual([
      "La campagne « Campagne 1 » sur Marque 1 est articulée avec celle-ci — en la rejetant, cette articulation disparaît.",
      "La campagne « Campagne 2 » sur Marque 2 est articulée avec celle-ci — en la rejetant, cette articulation disparaît.",
      "La campagne « Campagne 3 » sur Marque 3 est articulée avec celle-ci — en la rejetant, cette articulation disparaît.",
    ]);
  });

  it("plafonne à trois lignes détaillées et ajoute le compte réel restant (singulier)", () => {
    const lignes = construireTexteConfirmation(
      apercu({ articulationsRompues: [articulation(1), articulation(2), articulation(3), articulation(4)] }),
    );
    expect(lignes).toHaveLength(4);
    expect(lignes[3]).toBe("Et 1 autre campagne articulée avec celle-ci.");
  });

  it("plafonne à trois lignes détaillées et ajoute le compte réel restant (pluriel)", () => {
    const lignes = construireTexteConfirmation(
      apercu({
        articulationsRompues: [
          articulation(1),
          articulation(2),
          articulation(3),
          articulation(4),
          articulation(5),
        ],
      }),
    );
    expect(lignes[3]).toBe("Et 2 autres campagnes articulées avec celle-ci.");
  });

  it("omet « sur <marque> » quand la marque est vide", () => {
    const lignes = construireTexteConfirmation(
      apercu({ articulationsRompues: [{ campagneId: 1, campagneNom: "Solo", marque: "" }] }),
    );
    expect(lignes).toEqual([
      "La campagne « Solo » est articulée avec celle-ci — en la rejetant, cette articulation disparaît.",
    ]);
  });
});

describe("construireTexteConfirmation — prospection liée (volet serveur : la cascade)", () => {
  const prospection = (i: number) => ({ id: i, name: `Prospection ${i}` });

  it("aucune ligne quand il n'y a aucune prospection liée ni prospect à archiver", () => {
    const lignes = construireTexteConfirmation(apercu({ contenusGardes: 1 }));
    expect(lignes.some((l) => l.includes("prospection") || l.includes("archiv"))).toBe(false);
  });

  it("une ligne par campagne de prospection liée, « archivés » et jamais « supprimés » pour les prospects", () => {
    const lignes = construireTexteConfirmation(
      apercu({ prospectionLiee: [prospection(1)], prospectsAArchiver: 7 }),
    );
    expect(lignes).toEqual([
      "La campagne de prospection « Prospection 1 » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.",
      "7 prospects seront archivés.",
    ]);
  });

  it("accord singulier pour un seul prospect archivé", () => {
    const lignes = construireTexteConfirmation(
      apercu({ prospectionLiee: [prospection(1)], prospectsAArchiver: 1 }),
    );
    expect(lignes).toEqual([
      "La campagne de prospection « Prospection 1 » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.",
      "1 prospect sera archivé.",
    ]);
  });

  it("ne mentionne jamais « supprimé » pour les prospects, quel que soit le nombre", () => {
    const lignes = construireTexteConfirmation(
      apercu({ prospectionLiee: [prospection(1)], prospectsAArchiver: 12 }),
    );
    expect(lignes.join("\n")).not.toMatch(/supprim/);
  });

  it("omet la ligne des prospects archivés quand le compte est à zéro, même avec une prospection liée", () => {
    const lignes = construireTexteConfirmation(
      apercu({ prospectionLiee: [prospection(1)], prospectsAArchiver: 0 }),
    );
    expect(lignes.join("\n")).not.toMatch(/archiv/);
  });

  it("une ligne par prospection jusqu'à trois, sans ligne de compte restant", () => {
    const lignes = construireTexteConfirmation(
      apercu({ prospectionLiee: [prospection(1), prospection(2), prospection(3)] }),
    );
    expect(lignes).toEqual([
      "La campagne de prospection « Prospection 1 » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.",
      "La campagne de prospection « Prospection 2 » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.",
      "La campagne de prospection « Prospection 3 » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.",
    ]);
  });

  it("plafonne à trois lignes détaillées et ajoute le compte réel restant (singulier)", () => {
    const lignes = construireTexteConfirmation(
      apercu({ prospectionLiee: [prospection(1), prospection(2), prospection(3), prospection(4)] }),
    );
    expect(lignes).toHaveLength(4);
    expect(lignes[3]).toBe("Et 1 autre campagne de prospection liée à celle-ci.");
  });

  it("plafonne à trois lignes détaillées et ajoute le compte réel restant (pluriel)", () => {
    const lignes = construireTexteConfirmation(
      apercu({
        prospectionLiee: [
          prospection(1),
          prospection(2),
          prospection(3),
          prospection(4),
          prospection(5),
        ],
      }),
    );
    expect(lignes[3]).toBe("Et 2 autres campagnes de prospection liées à celle-ci.");
  });

  it("les lignes de prospection viennent après celles des articulations, dans l'ordre d'affichage", () => {
    const lignes = construireTexteConfirmation(
      apercu({
        articulationsRompues: [{ campagneId: 1, campagneNom: "Marketing liée", marque: "Marque" }],
        prospectionLiee: [prospection(1)],
        prospectsAArchiver: 2,
      }),
    );
    expect(lignes).toEqual([
      "La campagne « Marketing liée » sur Marque est articulée avec celle-ci — en la rejetant, cette articulation disparaît.",
      "La campagne de prospection « Prospection 1 » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.",
      "2 prospects seront archivés.",
    ]);
  });
});

describe("texteAvertissementRaisonVide — Décision 4 du spec : jamais de demi-mesure silencieuse", () => {
  it("avertit quand la raison est vide", () => {
    expect(texteAvertissementRaisonVide("")).toBe(
      "Sans raison, Naya ne pourra pas l'éviter la prochaine fois.",
    );
  });

  it("avertit quand la raison n'est que des espaces", () => {
    expect(texteAvertissementRaisonVide("   ")).toBe(
      "Sans raison, Naya ne pourra pas l'éviter la prochaine fois.",
    );
  });

  it("ne dit rien quand une raison a été saisie", () => {
    expect(texteAvertissementRaisonVide("le ton ne correspondait pas à la marque")).toBeNull();
  });
});

describe("construireMessageSucces", () => {
  function resultat(partial: Partial<ResultatRejet>): ResultatRejet {
    return {
      contenusDetaches: 0,
      contenusSupprimes: 0,
      tachesDetachees: 0,
      tachesSupprimees: 0,
      preferenceEcrite: false,
      preferenceSansEmbedding: false,
      articulationsRompues: [],
      ...partial,
    };
  }

  it("l'exemple complet du brief, en tenses passé", () => {
    const lignes = construireMessageSucces(
      resultat({ contenusDetaches: 3, tachesDetachees: 5, contenusSupprimes: 9, tachesSupprimees: 3, preferenceEcrite: true }),
      true,
    );
    expect(lignes).toEqual([
      "3 posts et 5 tâches ont été détachés de la campagne.",
      "9 posts et 3 tâches ont été supprimés.",
    ]);
  });

  it("aucune ligne quand rien n'a été détaché ni supprimé (campagne non lancée) et aucune raison", () => {
    expect(construireMessageSucces(resultat({}), false)).toEqual([]);
  });

  it("signale l'échec d'écriture quand une raison a été donnée mais preferenceEcrite est faux", () => {
    const lignes = construireMessageSucces(resultat({ preferenceEcrite: false }), true);
    expect(lignes).toEqual(["La raison n'a pas pu être enregistrée."]);
  });

  it("ne dit rien de l'écriture quand aucune raison n'a été donnée, même si preferenceEcrite est faux", () => {
    const lignes = construireMessageSucces(resultat({ preferenceEcrite: false }), false);
    expect(lignes).toEqual([]);
  });

  it("ne mentionne rien de l'écriture quand la préférence a bien été écrite", () => {
    const lignes = construireMessageSucces(
      resultat({ contenusDetaches: 1, preferenceEcrite: true }),
      true,
    );
    expect(lignes.join("\n")).not.toMatch(/raison/);
  });

  it("ne mentionne JAMAIS preferenceSansEmbedding, même quand il est vrai — information d'exploitation, pas pour l'utilisatrice", () => {
    const lignes = construireMessageSucces(
      resultat({ contenusDetaches: 1, preferenceEcrite: true, preferenceSansEmbedding: true }),
      true,
    );
    expect(lignes.join("\n")).not.toMatch(/embedding/i);
  });
});

describe("messageEchecRejet / messageEchecApercu — jamais « réessaie » sur un 404", () => {
  it("rejet : 404 affiche que la campagne n'existe plus, sans invite à réessayer", () => {
    const erreur = new Error('404: {"message":"Campaign not found"}');
    expect(messageEchecRejet(erreur)).toBe("Cette campagne n'existe déjà plus.");
  });

  it("aperçu : 404 affiche le même message", () => {
    const erreur = new Error('404: {"message":"Campaign not found"}');
    expect(messageEchecApercu(erreur)).toBe("Cette campagne n'existe déjà plus.");
  });

  it("rejet : une panne non définitive (500) invite à réessayer", () => {
    const erreur = new Error('500: {"message":"Failed to reject campaign"}');
    expect(messageEchecRejet(erreur)).toMatch(/réessaie/);
  });

  it("aperçu : une panne non définitive (500) invite à réessayer", () => {
    const erreur = new Error('500: {"message":"Failed to preview campaign rejection"}');
    expect(messageEchecApercu(erreur)).toMatch(/réessaie/);
  });

  it("une entrée qui n'est pas une Error ne fait pas planter la lecture", () => {
    expect(messageEchecRejet("quelque chose d'inattendu")).not.toBe("Cette campagne n'existe déjà plus.");
  });

  it("aucun des deux messages ne contient jamais « réessaie » pour le cas 404", () => {
    const erreur = new Error('404: {"message":"Campaign not found"}');
    expect(messageEchecRejet(erreur)).not.toMatch(/réessaie/);
    expect(messageEchecApercu(erreur)).not.toMatch(/réessaie/);
  });
});
