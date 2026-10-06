import { describe, it, expect } from "vitest";
import { appliquerEtatFait, idEvenementValide } from "./faits";

describe("appliquerEtatFait — l'état « fait » rejoint les événements injectés", () => {
  const evenements = [
    { id: -1000, gcalEventId: "abc_20261006T090000Z", source: "gcal", completed: false },
    { id: -1001, gcalEventId: "def", source: "gcal", completed: false },
    { id: 12, source: "naya", completed: false },
  ];

  it("marque fait uniquement les événements d'agenda dont l'id est dans l'ensemble", () => {
    const r = appliquerEtatFait(evenements, new Set(["def"]));
    expect(r.map((t) => t.completed)).toEqual([false, true, false]);
  });

  it("ne touche jamais une vraie tâche Naya, même si un id coïncide", () => {
    const r = appliquerEtatFait([{ id: 12, gcalEventId: "def", source: "naya", completed: false }], new Set(["def"]));
    expect(r[0].completed).toBe(false);
  });

  it("ne mute pas l'entrée", () => {
    appliquerEtatFait(evenements, new Set(["abc_20261006T090000Z"]));
    expect(evenements[0].completed).toBe(false);
  });
});

describe("idEvenementValide", () => {
  it("accepte les identifiants Google (y compris d'occurrence récurrente)", () => {
    expect(idEvenementValide("abc123def")).toBe(true);
    expect(idEvenementValide("7k2q8r_20261006T090000Z")).toBe(true);
  });
  it("refuse le vide, les espaces, les slash et les chaînes démesurées", () => {
    expect(idEvenementValide("")).toBe(false);
    expect(idEvenementValide("a b")).toBe(false);
    expect(idEvenementValide("a/b")).toBe(false);
    expect(idEvenementValide("x".repeat(1025))).toBe(false);
    expect(idEvenementValide(undefined as any)).toBe(false);
  });
});
