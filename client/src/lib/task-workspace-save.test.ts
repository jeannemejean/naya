import { describe, it, expect } from "vitest";
import { etatSauvegarde, risqueDePerte } from "./task-workspace-save";

/**
 * État du bouton « Enregistrer » de l'espace de travail d'une tâche.
 *
 * Ce qui existait avant. Chaque frappe armait un minuteur de 800 ms qui enregistrait tout
 * seul. Un drapeau `hasUnsavedRef` était posé à chaque frappe et remis à zéro à la
 * fermeture — mais il n'était JAMAIS LU. Fermer le panneau dans les 800 ms suivant la
 * dernière frappe annulait le minuteur et effaçait l'état : le texte était perdu, sans
 * message, sans trace.
 *
 * D'où une fonction pure : savoir s'il reste du travail non enregistré ne doit pas dépendre
 * d'un minuteur, et doit pouvoir être vérifié sans navigateur.
 */

const base = {
  contenu: "",
  titre: "",
  contenuEnregistre: null as string | null,
  titreEnregistre: null as string | null,
  enCours: false,
};

describe("etatSauvegarde", () => {
  it("un contenu vide ne peut pas être enregistré", () => {
    expect(etatSauvegarde({ ...base })).toBe("vide");
  });

  it("un contenu fait uniquement d'espaces compte comme vide", () => {
    // Bug visé : enregistrer une entrée blanche, qui encombre l'historique sans rien dire.
    // L'ancien code testait déjà `!c.trim()` ; ce test empêche de perdre ce garde.
    expect(etatSauvegarde({ ...base, contenu: "   \n\t  " })).toBe("vide");
  });

  it("un contenu jamais enregistré est modifié", () => {
    expect(etatSauvegarde({ ...base, contenu: "Un brouillon" })).toBe("modifie");
  });

  it("un contenu identique à ce qui est en base est enregistré", () => {
    expect(
      etatSauvegarde({ ...base, contenu: "Texte", contenuEnregistre: "Texte", titreEnregistre: "" }),
    ).toBe("enregistre");
  });

  it("un titre modifié seul compte comme une modification", () => {
    // Bug visé : ne comparer que le contenu. Le titre serait perdu en silence — le même
    // defaut, deplace d'un champ.
    expect(
      etatSauvegarde({
        ...base,
        contenu: "Texte",
        contenuEnregistre: "Texte",
        titre: "Nouveau titre",
        titreEnregistre: "",
      }),
    ).toBe("modifie");
  });

  it("l'enregistrement en cours l'emporte sur tout le reste", () => {
    expect(etatSauvegarde({ ...base, contenu: "Texte", enCours: true })).toBe("enregistrement");
  });

  it("un contenu vidé après enregistrement n'est pas « enregistre »", () => {
    // Bug visé : afficher « enregistré » sur un champ que l'utilisatrice vient d'effacer,
    // ce qui laisserait croire que l'effacement a été enregistré alors qu'il ne l'est pas.
    expect(etatSauvegarde({ ...base, contenu: "", contenuEnregistre: "Texte" })).toBe("vide");
  });
});

describe("risqueDePerte", () => {
  it("fermer sur une modification non enregistrée est un risque", () => {
    expect(risqueDePerte("modifie")).toBe(true);
  });

  it("fermer pendant un enregistrement est un risque", () => {
    // La requête peut encore échouer : tant qu'elle n'a pas abouti, le texte n'est nulle part.
    expect(risqueDePerte("enregistrement")).toBe(true);
  });

  it("fermer sur du vide ou du déjà enregistré ne risque rien", () => {
    expect(risqueDePerte("vide")).toBe(false);
    expect(risqueDePerte("enregistre")).toBe(false);
  });

  it("tout état est couvert", () => {
    // Bug visé : ajouter un état plus tard et oublier de décider s'il risque une perte.
    // Un `switch` sans cas par défaut renverrait `undefined`, donc « aucun risque ».
    for (const e of ["vide", "modifie", "enregistrement", "enregistre"] as const) {
      expect(typeof risqueDePerte(e), `état ${e}`).toBe("boolean");
    }
  });
});
