import { describe, it, expect } from "vitest";
import { nomUnipile, compteUnipile } from "./unipile";

describe("nomUnipile", () => {
  it("nomme le compte de l'utilisatrice ou celui d'un projet", () => {
    expect(nomUnipile("u1", null)).toBe("u1");
    expect(nomUnipile("u1", 7)).toBe("u1:projet:7");
  });
});

describe("compteUnipile", () => {
  const jeanne = { id: "a", name: "u1" };
  const client = { id: "b", name: "u1:projet:7" };
  it("projet : seulement le compte à son nom, jamais de repli", () => {
    expect(compteUnipile([jeanne, client], "u1", 7)).toBe(client);
    expect(compteUnipile([jeanne], "u1", 7)).toBeUndefined();
    expect(compteUnipile([{ id: "c", name: "autre" }], "u1", 7)).toBeUndefined();
  });
  it("utilisatrice : son nom, sinon l'unique compte s'il n'appartient pas à un projet", () => {
    expect(compteUnipile([client, jeanne], "u1", null)).toBe(jeanne);
    expect(compteUnipile([{ id: "c", name: "ancien" }], "u1", null)).toEqual({ id: "c", name: "ancien" });
    expect(compteUnipile([client], "u1", null)).toBeUndefined();
  });
});
