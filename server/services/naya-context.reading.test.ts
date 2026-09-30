// Section 8 de buildNayaContext — « la revue du jour ».
//
// `./db` et `../storage` sont mockés : aucun test n'exécute de requête réelle
// (DATABASE_URL pointe vers une base de production). La seule requête `db` de ce
// fichier est celle des fiches de lecture, ce qui rend la Section 8 observable
// isolément : le mock capture sa clause `where` (rendue en SQL par le dialecte
// Postgres de drizzle, hors connexion) et sert les lignes qu'on lui donne.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  fiches: [] as any[],
  wheres: [] as any[],
}));

vi.mock("../db", () => {
  const chaine = (): any => {
    const suite: any = {
      then: (ok: any, ko: any) => Promise.resolve(hoisted.fiches).then(ok, ko),
    };
    for (const m of ["from", "where", "orderBy", "limit"]) {
      suite[m] = (...args: any[]) => {
        if (m === "where") hoisted.wheres.push(args[0]);
        return suite;
      };
    }
    return suite;
  };
  return { db: { select: () => chaine() }, pool: { query: vi.fn(), on: vi.fn() } };
});

// Tout le reste du contexte passe par `storage`. Rendre `undefined` partout suffit :
// chaque section se contente de ne pas s'afficher, et seule la Section 8 nous intéresse.
vi.mock("../storage", () => ({
  storage: new Proxy({} as any, {
    get: () => async () => undefined,
  }),
}));

vi.mock("./memory/retrieve", () => ({
  retrieveMemories: async () => ({ cap: [], founder: [], reception: [], savoir: [] }),
}));

const { buildNayaContext } = await import("./naya-context");

const fiche = (over: Record<string, unknown> = {}) => ({
  id: 1, projectId: 7, title: "Un titre", url: "https://media.fr/a",
  factSummary: "LE FAIT DU JOUR", angle: "UN ANGLE POSSIBLE", question: "Et toi ?",
  userAnswer: null, status: "proposed", relevanceScore: 0.9, ...over,
});

beforeEach(() => {
  hoisted.fiches = [];
  hoisted.wheres = [];
});

describe("Section 8 — les fiches du jour dans le contexte de Naya", () => {
  it("une fiche GARDÉE et répondue aujourd'hui entre dans le contexte", async () => {
    // Le défaut fermé ici : la liste des statuts avait été écrite quand `kept` et
    // `answered` ne pouvaient pas coexister. Depuis que `kept` survit à une réponse,
    // une fiche peut être gardée ET répondue le même jour — et c'est la plus précieuse
    // de toutes. Ce n'est pas le statut qui compte, c'est l'avis.
    hoisted.fiches = [fiche({ status: "kept", userAnswer: "MON AVIS DE FONDATRICE" })];

    const contexte = await buildNayaContext("u1", null);

    expect(contexte).toContain("LE FAIT DU JOUR");
    expect(contexte).toContain("UN ANGLE POSSIBLE");
    expect(contexte).toContain("MON AVIS DE FONDATRICE");
  });

  it("la requête retient proposed, answered et kept, et reste bornée à minuit UTC", async () => {
    await buildNayaContext("u1", null);
    const { sql, params } = new PgDialect().sqlToQuery(hoisted.wheres[0]);

    expect(params).toEqual(expect.arrayContaining(["proposed", "answered", "kept"]));
    // Les statuts terminaux ne sont jamais réinjectés — « les expirées non ».
    expect(params).not.toEqual(expect.arrayContaining(["expired"]));
    expect(params).not.toEqual(expect.arrayContaining(["rejected"]));
    // La borne de date est ce qui écarte le rayonnage ancien : seules les fiches gardées
    // AUJOURD'HUI entrent, jamais celles de la semaine dernière.
    expect(sql).toContain('"reading_cards"."created_at" >=');
  });

  it("aucune fiche aujourd'hui → aucune section, et rien qui ressemble à une excuse", async () => {
    hoisted.fiches = [];
    const contexte = await buildNayaContext("u1", null);
    expect(contexte).not.toContain("revue du jour");
  });
});
