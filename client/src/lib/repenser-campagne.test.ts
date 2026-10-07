import { describe, it, expect } from "vitest";
import {
  cleErreurEtat, cleErreurPost, codeErreurPost, campagneRepensable,
  delaiDepasse, intervalleRelecture, REPENSER_DELAI_MAX_MS, REPENSER_POLL_MS,
} from "./repenser-campagne";

describe("repenser-campagne", () => {
  it("mappe les codes d'échec d'état", () => {
    expect(cleErreurEtat({ code: "generation_echouee" })).toBe("generation_echouee");
    expect(cleErreurEtat({ code: "placement_echoue" })).toBe("placement_echoue");
    expect(cleErreurEtat({ code: "deja_en_cours" })).toBe("deja_en_cours");
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
});
