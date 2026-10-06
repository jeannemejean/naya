import { describe, it, expect } from "vitest";
import {
  estTacheDeProduction, decisionAuCochage, limiteOctets, typeAccepte,
  lienValide, planDeRangement, titreMemoire,
} from "./livrables";

describe("estTacheDeProduction", () => {
  it.each([
    "Photographier 3 détails de ton environnement créatif + annoter chacun avec une observation",
    "Rédiger ton pitch",
    "Rédige ton pitch en 3 phrases",
    "Liste 10 prospects idéaux",
    "📸 Photographier ton bureau",
    "- Filmer une story coulisses",
    "CRÉER le visuel de lancement",
  ])("repère « %s »", (titre) => {
    expect(estTacheDeProduction(titre)).toBe(true);
  });

  it.each(["Appeler Marie", "Réunion client", "Ostéopathes Mr Darcy", "", "Relancer le devis Dupont"])(
    "ne repère pas « %s »",
    (titre) => expect(estTacheDeProduction(titre)).toBe(false),
  );
});

describe("decisionAuCochage", () => {
  const prod = "Photographier 3 détails";
  it("demande le livrable pour une tâche de production sans dépôt", () => {
    expect(decisionAuCochage({ titre: prod, dejaTerminee: false, nbLivrables: 0 })).toBe("demander");
  });
  it("coche directement si un livrable existe déjà", () => {
    expect(decisionAuCochage({ titre: prod, dejaTerminee: false, nbLivrables: 1 })).toBe("cocher");
  });
  it("ne demande jamais au décochage", () => {
    expect(decisionAuCochage({ titre: prod, dejaTerminee: true, nbLivrables: 0 })).toBe("cocher");
  });
  it("coche directement une tâche qui n'est pas de production", () => {
    expect(decisionAuCochage({ titre: "Appeler Marie", dejaTerminee: false, nbLivrables: 0 })).toBe("cocher");
  });
});

describe("limites et types", () => {
  const Mo = 1024 * 1024;
  it("25 Mo photo, 200 Mo vidéo, 25 Mo fichier", () => {
    expect(limiteOctets("media", "image/jpeg")).toBe(25 * Mo);
    expect(limiteOctets("media", "video/mp4")).toBe(200 * Mo);
    expect(limiteOctets("fichier", "application/pdf")).toBe(25 * Mo);
  });
  it("médias : image et vidéo seulement", () => {
    expect(typeAccepte("media", "image/png")).toBe(true);
    expect(typeAccepte("media", "video/quicktime")).toBe(true);
    expect(typeAccepte("media", "application/pdf")).toBe(false);
  });
  it("fichiers : PDF, Word, Excel, PowerPoint, texte, CSV", () => {
    for (const m of [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ]) expect(typeAccepte("fichier", m)).toBe(true);
    expect(typeAccepte("fichier", "image/png")).toBe(false);
    expect(typeAccepte("fichier", "application/x-msdownload")).toBe(false);
  });
});

describe("lienValide", () => {
  it("accepte http et https", () => {
    expect(lienValide("https://www.linkedin.com/in/jeanne")).toBe(true);
    expect(lienValide("http://exemple.fr/a?b=c")).toBe(true);
  });
  it("refuse le reste", () => {
    for (const u of ["", "exemple.fr", "javascript:alert(1)", "ftp://x.fr", "https://"]) {
      expect(lienValide(u)).toBe(false);
    }
  });
});

describe("planDeRangement", () => {
  it("photo décrite → médiathèque + mémoire", () => {
    expect(planDeRangement({ kind: "media", content: "Lumière du matin sur l'atelier" }))
      .toEqual({ mediatheque: true, memoire: "Lumière du matin sur l'atelier" });
  });
  it("photo sans description → médiathèque, aucun souvenir vide", () => {
    expect(planDeRangement({ kind: "media", content: "   " })).toEqual({ mediatheque: true, memoire: null });
  });
  it("texte → mémoire seulement", () => {
    expect(planDeRangement({ kind: "texte", content: "Mon pitch" })).toEqual({ mediatheque: false, memoire: "Mon pitch" });
  });
  it("lien sans note → rien en mémoire", () => {
    expect(planDeRangement({ kind: "lien", content: null })).toEqual({ mediatheque: false, memoire: null });
  });
  it("fichier → jamais en médiathèque", () => {
    expect(planDeRangement({ kind: "fichier", content: "Devis signé" })).toEqual({ mediatheque: false, memoire: "Devis signé" });
  });
});

describe("titreMemoire", () => {
  it("dit de quelle tâche vient le souvenir", () => {
    expect(titreMemoire("Photographier 3 détails")).toBe("Livrable — Photographier 3 détails");
  });
  it("a un repli sans tâche", () => {
    expect(titreMemoire(null)).toBe("Livrable déposé");
    expect(titreMemoire("  ")).toBe("Livrable déposé");
  });
});
