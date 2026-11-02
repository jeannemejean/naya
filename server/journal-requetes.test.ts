import { describe, it, expect } from "vitest";
import { cheminJournal, corpsJournalisable, estPagePrivee } from "./journal-requetes";

describe("journal des requêtes — un lien privé ne s'écrit jamais en clair", () => {
  it("masque le jeton d'un rapport public", () => {
    expect(cheminJournal("/api/public/rapports/AbC_123-xyzAbC_123-xyzAbC_123-xyzAbC_123")).toBe("/api/public/rapports/[jeton]");
    expect(cheminJournal("/api/tasks/12")).toBe("/api/tasks/12");
  });
  it("n'écrit pas le contenu d'un rapport public", () => {
    expect(corpsJournalisable("/api/public/rapports/xyz")).toBe(false);
    expect(corpsJournalisable("/api/tasks")).toBe(true);
  });
  it("n'écrit jamais le corps des réponses de la boîte (/api/reponses et sous-chemins)", () => {
    expect(corpsJournalisable("/api/reponses")).toBe(false);
    expect(corpsJournalisable("/api/reponses/12")).toBe(false);
    expect(corpsJournalisable("/api/reponses/12/messages")).toBe(false);
    expect(corpsJournalisable("/api/reponses?statut=a_traiter")).toBe(false);
    expect(corpsJournalisable("/api/reponsesX")).toBe(true);
  });
});

describe("estPagePrivee — pages à ne jamais indexer", () => {
  it("la page d'un rapport client", () => {
    expect(estPagePrivee("/rapport/AbC")).toBe(true);
    expect(estPagePrivee("/rapports")).toBe(false);
    expect(estPagePrivee("/")).toBe(false);
  });
});
