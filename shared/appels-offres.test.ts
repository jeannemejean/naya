import { describe, it, expect } from "vitest";
import {
  joursAvant, mapperLigneNotion, offresDepuisNotion, scoreDepuisNotion, statutDepuisNotion, instantDepuisNotion,
} from "./appels-offres";

// Forme réelle d'une ligne exportée (requête SQL du data source Notion), données inventées.
const ligne = (over: Record<string, unknown> = {}) => ({
  id: "3f62272a-1ac0-8100-97c6-e8cc37aa62e6",
  url: "https://app.notion.com/3f62272a1ac0810097c6e8cc37aa62e6",
  createdTime: "2026-10-11 17:24:23Z",
  "date:Date limite:start": "2026-11-09 09:00:00Z",
  "date:Date limite:end": null,
  "date:Date limite:is_datetime": 1,
  "Lien DCE": "https://dce.example/1",
  "Critères et pondération": "Prix 40 %, valeur technique 60 %",
  "Référence": "BOAMP 26-00001",
  "Montant estimé HT": 60000,
  "Notes": "Accord-cadre 4 ans.",
  "Score adéquation": "🔥 Fort",
  "Bloquants": null,
  "Acheteur": "Ville d'Exemple",
  "date:Date repérage:start": "2026-10-11",
  "date:Date repérage:end": null,
  "date:Date repérage:is_datetime": 0,
  "Procédure": "Appel d'offres ouvert",
  "Département": "Rhône (69)",
  "Premier jet": "https://claude.ai/artifact/abc",
  "Statut": "📄 Premier jet prêt",
  "Lien avis": "https://avis.example/1",
  "Offre JMD": "[\"IN SCENA\",\"IN SITU\"]",
  "Pièces exigées": "DC1, DC2, mémoire technique",
  "Objet": "Communication des programmations 2027",
  ...over,
});

describe("mapperLigneNotion", () => {
  it("mappe une ligne complète", () => {
    const r = mapperLigneNotion(ligne())!;
    expect(r).toMatchObject({
      objet: "Communication des programmations 2027",
      acheteur: "Ville d'Exemple",
      reference: "BOAMP 26-00001",
      procedure: "Appel d'offres ouvert",
      dateReperage: "2026-10-11",
      departement: "Rhône (69)",
      montantEstimeHt: "60000.00",
      scoreAdequation: "fort",
      offresJmd: ["IN SITU", "IN SCENA"],
      statut: "premier_jet_pret",
      bloquants: null,
      premierJet: "https://claude.ai/artifact/abc",
      source: "notion_import",
      sourceId: "3f62272a1ac0810097c6e8cc37aa62e6",
    });
    expect(r.dateLimite!.toISOString()).toBe("2026-11-09T09:00:00.000Z");
  });

  it("ligne maigre : champs vides à null, statut par défaut", () => {
    const r = mapperLigneNotion(ligne({
      "Montant estimé HT": null, "Score adéquation": null, "Statut": null, "Offre JMD": null,
      "Référence": "", "Procédure": null, "date:Date limite:start": null,
    }))!;
    expect(r).toMatchObject({
      montantEstimeHt: null, scoreAdequation: null, statut: "repere", offresJmd: [],
      reference: null, procedure: null, dateLimite: null,
    });
  });

  it("sans objet ou sans id de page : ignorée", () => {
    expect(mapperLigneNotion(ligne({ Objet: "  " }))).toBeNull();
    expect(mapperLigneNotion(ligne({ id: null, url: null }))).toBeNull();
  });

  it("retrouve l'id depuis l'URL quand la colonne id manque", () => {
    expect(mapperLigneNotion(ligne({ id: undefined }))!.sourceId).toBe("3f62272a1ac0810097c6e8cc37aa62e6");
  });
});

describe("valeurs Notion", () => {
  it("statuts à emoji", () => {
    expect(statutDepuisNotion("🆕 Repéré")).toBe("repere");
    expect(statutDepuisNotion("✍️ En rédaction")).toBe("en_redaction");
    expect(statutDepuisNotion("📨 Déposé")).toBe("depose");
    expect(statutDepuisNotion("🏆 Gagné")).toBe("gagne");
    expect(statutDepuisNotion("❌ Perdu")).toBe("perdu");
    expect(statutDepuisNotion("⏭ Écarté")).toBe("ecarte");
    expect(statutDepuisNotion("inconnu")).toBe("repere");
  });
  it("scores", () => {
    expect(scoreDepuisNotion("🌡 Moyen")).toBe("moyen");
    expect(scoreDepuisNotion("❄️ Faible")).toBe("faible");
    expect(scoreDepuisNotion("Énorme")).toBeNull();
  });
  it("offres : JSON, liste, intrus ignorés", () => {
    expect(offresDepuisNotion('["IN LINEA","IN SCENA","IN SITU"]')).toEqual(["IN SITU", "IN LINEA", "IN SCENA"]);
    expect(offresDepuisNotion(["in scena", "AUTRE"])).toEqual(["IN SCENA"]);
    expect(offresDepuisNotion("pas du json")).toEqual([]);
  });
  it("date sans heure : midi UTC le même jour", () => {
    expect(instantDepuisNotion("2033-04-19", 0)!.toISOString()).toBe("2033-04-19T12:00:00.000Z");
    expect(instantDepuisNotion("n'importe quoi", 1)).toBeNull();
  });
});

describe("joursAvant", () => {
  const maintenant = new Date("2026-11-10T08:00:00Z");
  it("compte en jours calendaires à Paris", () => {
    expect(joursAvant("2026-11-10T22:30:00Z", maintenant)).toBe(0); // 23 h 30 à Paris, même jour
    expect(joursAvant("2026-11-10T23:30:00Z", maintenant)).toBe(1); // 0 h 30 le lendemain à Paris
    expect(joursAvant("2026-11-20T11:00:00Z", maintenant)).toBe(10);
    expect(joursAvant("2026-11-09T09:00:00Z", maintenant)).toBe(-1);
    expect(joursAvant(null, maintenant)).toBeNull();
  });
});
