// Tests des consignes de l'agent (fonctions PURES). buildNayaContext est mocké : aucun accès
// à la base.
import { describe, it, expect, vi } from "vitest";

vi.mock("../naya-context", () => ({ buildNayaContext: vi.fn(async () => "") }));

const { REGLES_AGENT, blocSession, tachesDuJourPropres, evenementsPropres } = await import("./consignes");

const session = { maintenant: new Date("2026-11-02T10:00:00Z"), fuseau: "Europe/Paris", plateforme: "web" };

describe("REGLES_AGENT — marque-sujet", () => {
  it("ne demande jamais la marque pour son rythme, son énergie, ses habitudes, sa façon de travailler", () => {
    expect(REGLES_AGENT).toMatch(/rythme/);
    expect(REGLES_AGENT).toMatch(/énergie/);
    expect(REGLES_AGENT).toMatch(/habitudes/);
    expect(REGLES_AGENT).toMatch(/NE DEMANDE JAMAIS/);
  });
  it("garde la règle complète pour l'identité, le positionnement, l'offre, la voix", () => {
    for (const mot of ["IDENTITÉ", "POSITIONNEMENT", "OFFRE", "VOIX"]) expect(REGLES_AGENT).toContain(mot);
    expect(REGLES_AGENT).toMatch(/ne redemande pas/i);
    expect(REGLES_AGENT).toMatch(/Ne devine jamais/i);
  });
});

describe("listes envoyées par le client : formes vérifiées", () => {
  it("tachesDuJourPropres ne garde que des objets avec un titre texte", () => {
    const brut = [null, 3, "x", [], { title: 4 }, { title: "Appeler Léa", completed: true, scheduledTime: "09:00" }, { title: "B", completed: "oui", scheduledTime: 12 }];
    expect(tachesDuJourPropres(brut)).toEqual([
      { title: "Appeler Léa", completed: true, scheduledTime: "09:00" },
      { title: "B", completed: false, scheduledTime: null },
    ]);
    expect(tachesDuJourPropres({ title: "pas une liste" })).toBeUndefined();
    expect(tachesDuJourPropres(undefined)).toBeUndefined();
  });

  it("evenementsPropres exige titre et date en texte", () => {
    const brut = [null, { title: "RDV" }, { title: "Salon", date: "2026-11-04", time: "10:00" }, { title: "X", date: "2026-11-05", time: 9 }];
    expect(evenementsPropres(brut)).toEqual([
      { title: "Salon", date: "2026-11-04", time: "10:00" },
      { title: "X", date: "2026-11-05" },
    ]);
  });

  it("blocSession ne plante pas sur des éléments nuls", () => {
    const s = blocSession({ ...session, tachesDuJour: [null, { title: "A" }] as any, evenementsAVenir: [undefined, { title: "E", date: "2026-11-04" }] as any });
    expect(s).toContain("- [à faire] A");
    expect(s).toContain("- E le 2026-11-04");
  });
});
