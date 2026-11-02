import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { jetonDesinscription, leadDuJeton, lienDesinscription } from "./desinscription";

const SAVE = { ...process.env };
beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = "secret-de-test";
  process.env.APP_URL = "https://hellonaya.app";
});
afterEach(() => { process.env = { ...SAVE }; });

describe("jeton de désinscription", () => {
  it("aller-retour : le jeton redonne le lead", () => {
    expect(leadDuJeton(jetonDesinscription(42))).toBe(42);
  });
  it("jeton modifié, tronqué ou vide → null", () => {
    const j = jetonDesinscription(42);
    expect(leadDuJeton(j.replace(/^42/, "43"))).toBeNull();
    expect(leadDuJeton(j.slice(0, -1) + (j.endsWith("a") ? "b" : "a"))).toBeNull();
    expect(leadDuJeton(j.slice(0, -4))).toBeNull();
    expect(leadDuJeton("")).toBeNull();
    expect(leadDuJeton("n'importe quoi")).toBeNull();
  });
  it("jeton signé avec un autre secret → null", () => {
    const j = jetonDesinscription(7);
    process.env.UNSUBSCRIBE_SECRET = "autre";
    expect(leadDuJeton(j)).toBeNull();
  });
  it("retombe sur SESSION_SECRET sans UNSUBSCRIBE_SECRET", () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    process.env.SESSION_SECRET = "session";
    expect(leadDuJeton(jetonDesinscription(5))).toBe(5);
  });
  it("aucun secret → pas de jeton (jamais de signature vide)", () => {
    delete process.env.UNSUBSCRIBE_SECRET; delete process.env.SESSION_SECRET;
    expect(() => jetonDesinscription(1)).toThrow();
    expect(leadDuJeton("1.abc")).toBeNull();
    expect(lienDesinscription(1)).toBeNull();
  });
});

describe("lienDesinscription", () => {
  it("APP_URL/desinscription/jeton, sans double barre", () => {
    process.env.APP_URL = "https://hellonaya.app/";
    expect(lienDesinscription(42)).toBe(`https://hellonaya.app/desinscription/${jetonDesinscription(42)}`);
  });
  it("APP_URL absent → null (l'appelant n'envoie pas)", () => {
    delete process.env.APP_URL;
    expect(lienDesinscription(42)).toBeNull();
  });
});
