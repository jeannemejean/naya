import { describe, it, expect } from "vitest";
import {
  cleErreurEtat, cleErreurPost, codeErreurPost, campagneRepensable, suiviPerdu, clePlacementApercu,
  delaiDepasse, intervalleRelecture, resultatAcceptable, intervalleSuivi, doitReprendreSuivi, REPENSER_TOLERANCE_HORLOGE_MS, REPENSER_DELAI_MAX_MS, REPENSER_POLL_MS,
} from "./repenser-campagne";

describe("repenser-campagne", () => {
  it("suivi perdu : « aucun » pendant le suivi (redémarrage du serveur) — et seulement là", () => {
    expect(suiviPerdu(true, "aucun")).toBe(true);
    expect(suiviPerdu(true, "en_cours")).toBe(false);
    expect(suiviPerdu(true, "termine")).toBe(false);
    expect(suiviPerdu(true, undefined)).toBe(false);
    expect(suiviPerdu(false, "aucun")).toBe(false);
  });

  it("ligne d'aperçu selon le placement", () => {
    expect(clePlacementApercu("lancement")).toBe("previewPlacementLancement");
    expect(clePlacementApercu("reprise")).toBe("previewPlacementReprise");
    expect(clePlacementApercu("maintenant")).toBeNull();
    expect(clePlacementApercu(undefined)).toBeNull();
  });

  it("mappe les codes d'échec d'état", () => {
    expect(cleErreurEtat({ code: "generation_echouee" })).toBe("generation_echouee");
    expect(cleErreurEtat({ code: "placement_echoue" })).toBe("placement_echoue");
    expect(cleErreurEtat({ code: "deja_en_cours" })).toBe("deja_en_cours");
    expect(cleErreurEtat({ code: "statut_incompatible" })).toBe("statut_incompatible");
    expect(cleErreurEtat({ code: "erreur" })).toBe("generique");
    expect(cleErreurEtat(undefined)).toBe("generique");
  });

  it("lit le code d'une erreur de POST", () => {
    const e = new Error('409: {"message":"deja_en_cours"}');
    expect(codeErreurPost(e)).toBe("deja_en_cours");
    expect(cleErreurPost(e)).toBe("deja_en_cours");
    expect(cleErreurPost(new Error('409: {"message":"statut_incompatible","statut":"completed"}'))).toBe("statut_incompatible");
    expect(cleErreurPost(new Error('400: {"message":"consigne_trop_longue","max":1000}'))).toBe("consigne_trop_longue");
    expect(cleErreurPost(new Error("500: boom"))).toBe("generique");
    expect(cleErreurPost(new TypeError("Failed to fetch"))).toBe("generique");
    expect(codeErreurPost(null)).toBeNull();
  });

  it("statuts repensables", () => {
    expect(campagneRepensable("draft")).toBe(true);
    expect(campagneRepensable("active")).toBe(true);
    expect(campagneRepensable("paused")).toBe(true);
    expect(campagneRepensable("completed")).toBe(false);
    expect(campagneRepensable(null)).toBe(false);
  });

  it("délai maximal et intervalle", () => {
    expect(delaiDepasse(0, REPENSER_DELAI_MAX_MS)).toBe(false);
    expect(delaiDepasse(0, REPENSER_DELAI_MAX_MS + 1)).toBe(true);
    expect(intervalleRelecture("en_cours")).toBe(REPENSER_POLL_MS);
    expect(intervalleRelecture("termine")).toBe(false);
    expect(intervalleRelecture("echec")).toBe(false);
    expect(intervalleRelecture(undefined)).toBe(false);
  });

  it("n'accepte qu'un résultat issu du travail lancé", () => {
    const lance = Date.parse("2026-10-07T10:00:00Z");
    expect(resultatAcceptable({}, lance)).toBe(true);
    expect(resultatAcceptable({ debut: "2026-10-07T10:00:01Z" }, lance)).toBe(true);
    expect(resultatAcceptable({ debut: new Date(lance - REPENSER_TOLERANCE_HORLOGE_MS + 1000).toISOString() }, lance)).toBe(true);
    expect(resultatAcceptable({ debut: "2026-10-07T09:50:00Z" }, lance)).toBe(false);
    expect(resultatAcceptable({ debut: "n'importe quoi" }, lance)).toBe(true);
  });

  it("arrête le polling et bloque la reprise après abandon", () => {
    expect(intervalleSuivi("en_cours", false)).toBe(REPENSER_POLL_MS);
    expect(intervalleSuivi("en_cours", true)).toBe(false);
    const base = { open: true, suivi: false, abandonne: false, etat: "en_cours" as const, enVol: false };
    expect(doitReprendreSuivi(base)).toBe(true);
    expect(doitReprendreSuivi({ ...base, abandonne: true })).toBe(false);
    expect(doitReprendreSuivi({ ...base, suivi: true })).toBe(false);
    expect(doitReprendreSuivi({ ...base, enVol: true })).toBe(false);
    expect(doitReprendreSuivi({ ...base, open: false })).toBe(false);
  });
});
