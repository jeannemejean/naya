// Tests de l'indexeur de la recherche par sens. `../../db` et `../memory/embed` sont mockés :
// aucun test ne touche une vraie base ni le service d'embeddings (consigne projet). La requête
// des candidats est rendue en SQL avec le dialecte Postgres de drizzle, hors connexion.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  executes: [] as any[],
  lignes: [] as any[],
  inserts: [] as any[],
  conflits: [] as any[],
  embedLots: vi.fn(),
  bloquer: null as null | Promise<void>,
  etat: {} as any,
}));

vi.mock("../../db", () => ({
  db: {
    execute: async (q: any) => {
      hoisted.executes.push(q);
      if (hoisted.bloquer) await hoisted.bloquer;
      return { rows: hoisted.lignes };
    },
    insert: () => ({
      values: (v: any) => {
        hoisted.inserts.push(v);
        return {
          onConflictDoUpdate: async (c: any) => { hoisted.conflits.push(c); },
        };
      },
    }),
  },
  pool: { query: vi.fn(), on: vi.fn() },
}));

// Le suivi de santé ne touche jamais une vraie base dans les tests.
vi.mock("../fil/etat-taches-fond", () => ({ suivrePassage: async (_n: string, fn: () => Promise<unknown>) => fn() }));

vi.mock("../memory/embed", () => ({
  embedTextsParLots: hoisted.embedLots,
  embedText: vi.fn(),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
  lireEtatEmbeddings: () => hoisted.etat,
}));

import { indexerUnLot, passerIndexeur, requeteCandidats, TEXTE_MAX, _reinitialiserMisDeCote } from "./indexeur";

const dialecte = new PgDialect();
const rendre = (q: any) => dialecte.sqlToQuery(q);

beforeEach(() => {
  hoisted.executes.length = 0;
  hoisted.lignes = [];
  hoisted.inserts.length = 0;
  hoisted.conflits.length = 0;
  hoisted.embedLots.mockReset();
  hoisted.bloquer = null;
  hoisted.etat = {};
  _reinitialiserMisDeCote();
});

describe("requeteCandidats", () => {
  it("prend les quatre sources, avec leurs conditions, et jamais les messages des prospects", () => {
    const q = rendre(requeteCandidats(64));
    const s = q.sql.toLowerCase();
    expect(s).toContain("task_workspace_entries");
    expect(s).toMatch(/char_length\([^)]*content[^)]*\) >= 20/);
    expect(s).toContain("livrables");
    expect(s).toContain("kind = 'texte'");
    expect(s).toContain("quick_capture_entries");
    expect(s).toContain("companion_conversations");
    expect(s).toContain("role = 'user'");
    expect(s).not.toContain("inbox_messages");
    expect(s).not.toContain("inbox_conversations");
    for (const src of ["tache_reponse", "livrable", "note", "conversation"]) expect(s).toContain(`'${src}'`);
  });

  it("ne garde que le jamais indexé ou le modifié (md5), tronqué à 8000 caractères", () => {
    const q = rendre(requeteCandidats(64));
    const s = q.sql.toLowerCase();
    expect(s).toContain("left join recherche_embeddings");
    expect(s).toMatch(/r\.id is null or r\.contenu_md5 <> md5\(/);
    expect(s).toContain(`left(`);
    expect(q.params).toEqual(expect.arrayContaining([TEXTE_MAX, 64]));
    expect(TEXTE_MAX).toBe(8000);
  });

  it("le titre (tâche ou livrable) précède le contenu, séparé d'un saut de ligne", () => {
    const s = rendre(requeteCandidats(64)).sql.toLowerCase();
    expect(s).toMatch(/t\.title \|\| e'\\n' \|\| e\.content/);
    expect(s).toMatch(/coalesce\(l\.task_title, l\.file_name\)/);
  });
});

describe("requeteCandidats : ordre et mis de côté", () => {
  it("ordre déterministe (source, source_id)", () => {
    expect(rendre(requeteCandidats(64)).sql.toLowerCase()).toMatch(/order by s\.source, s\.source_id/);
  });

  it("les lignes mises de côté sont exclues en SQL, avant la limite", () => {
    const q = rendre(requeteCandidats(64, ["note:4:abc"]));
    const s = q.sql.toLowerCase();
    expect(s).toMatch(/not in \(\$\d+\)/);
    expect(s.indexOf("not in")).toBeLessThan(s.indexOf("limit"));
    expect(q.params).toContain("note:4:abc");
    expect(rendre(requeteCandidats(64, [])).sql.toLowerCase()).not.toContain("not in");
  });
});

describe("indexerUnLot : ligne refusée par le service", () => {
  const ligne = (source: string, id: number, texte: string) =>
    ({ source, source_id: id, user_id: "u1", texte, md5: `md5-${id}` });
  const echecRecent = (raison: string) => { hoisted.etat = { dernierEchec: { a: new Date(Date.now() + 1000), raison } }; };

  it("lot tout en échec pour un refus de texte : reprise ligne à ligne, la mauvaise est mise de côté", async () => {
    hoisted.lignes = [ligne("note", 1, "bon1"), ligne("note", 2, "poison"), ligne("note", 3, "bon3")];
    hoisted.embedLots.mockImplementation(async (textes: string[]) => {
      if (textes.length > 1) { echecRecent("invalid_request_error"); return textes.map(() => null); }
      if (textes[0] === "poison") { echecRecent("invalid_request_error"); return [null]; }
      return [[0.5]];
    });
    expect(await indexerUnLot()).toEqual({ indexes: 2, echecs: 1 });
    expect(hoisted.embedLots).toHaveBeenCalledTimes(4); // le lot, puis 3 reprises
    expect(hoisted.inserts[0].map((v: any) => v.sourceId)).toEqual([1, 3]);

    // Passage suivant : la ligne refusée (même md5) est exclue de la requête.
    hoisted.lignes = [];
    await indexerUnLot();
    const q = rendre(hoisted.executes[1]);
    expect(q.sql.toLowerCase()).toContain("not in");
    expect(q.params).toContain("note:2:md5-2");
  });

  it("panne globale (clé, quota, réseau) : aucune reprise ligne à ligne", async () => {
    for (const raison of ["invalid_api_key", "insufficient_quota", "indisponible", "timeout", "http_429", "http_500", "erreur"]) {
      hoisted.embedLots.mockReset();
      hoisted.lignes = [ligne("note", 1, "a"), ligne("note", 2, "b")];
      hoisted.embedLots.mockImplementation(async (textes: string[]) => { echecRecent(raison); return textes.map(() => null); });
      expect(await indexerUnLot(), raison).toEqual({ indexes: 0, echecs: 2 });
      expect(hoisted.embedLots, raison).toHaveBeenCalledTimes(1);
    }
    // Rien n'est mis de côté : une panne globale ne condamne aucune ligne.
    hoisted.lignes = [];
    await indexerUnLot();
    expect(rendre(hoisted.executes.at(-1)).sql.toLowerCase()).not.toContain("not in");
  });

  it("reprise interrompue si une panne globale survient en cours de route", async () => {
    hoisted.lignes = [ligne("note", 1, "a"), ligne("note", 2, "b"), ligne("note", 3, "c")];
    hoisted.embedLots.mockImplementation(async (textes: string[]) => {
      if (textes.length > 1) { echecRecent("invalid_request_error"); return textes.map(() => null); }
      echecRecent("timeout");
      return [null];
    });
    expect(await indexerUnLot()).toEqual({ indexes: 0, echecs: 3 });
    expect(hoisted.embedLots).toHaveBeenCalledTimes(2); // le lot + une seule reprise
    hoisted.lignes = [];
    await indexerUnLot();
    expect(rendre(hoisted.executes.at(-1)).sql.toLowerCase()).not.toContain("not in");
  });

  it("une ligne seule refusée est mise de côté sans reprise", async () => {
    hoisted.lignes = [ligne("note", 2, "poison")];
    hoisted.embedLots.mockImplementation(async () => { echecRecent("invalid_request_error"); return [null]; });
    expect(await indexerUnLot()).toEqual({ indexes: 0, echecs: 1 });
    expect(hoisted.embedLots).toHaveBeenCalledTimes(1);
    hoisted.lignes = [];
    await indexerUnLot();
    expect(rendre(hoisted.executes.at(-1)).params).toContain("note:2:md5-2");
  });
});

describe("indexerUnLot", () => {
  const ligne = (source: string, id: number, texte: string) =>
    ({ source, source_id: id, user_id: "u1", texte, md5: `md5-${id}` });

  it("indexe les lignes embeddées, compte les échecs sans lever", async () => {
    hoisted.lignes = [ligne("note", 1, "a"), ligne("livrable", 2, "b"), ligne("conversation", 3, "c")];
    hoisted.embedLots.mockResolvedValue([[0.1, 0.2], null, [0.3, 0.4]]);
    const r = await indexerUnLot();
    expect(r).toEqual({ indexes: 2, echecs: 1 });
    expect(hoisted.embedLots).toHaveBeenCalledWith(["a", "b", "c"], expect.anything());
    expect(hoisted.inserts).toHaveLength(1);
    expect(hoisted.inserts[0]).toEqual([
      expect.objectContaining({ userId: "u1", source: "note", sourceId: 1, contenuMd5: "md5-1", embedding: [0.1, 0.2] }),
      expect.objectContaining({ userId: "u1", source: "conversation", sourceId: 3, contenuMd5: "md5-3", embedding: [0.3, 0.4] }),
    ]);
    expect(hoisted.conflits).toHaveLength(1);
  });

  it("toutes les lignes en échec : rien n'est écrit", async () => {
    hoisted.lignes = [ligne("note", 1, "a")];
    hoisted.embedLots.mockResolvedValue([null]);
    expect(await indexerUnLot()).toEqual({ indexes: 0, echecs: 1 });
    expect(hoisted.inserts).toHaveLength(0);
  });

  it("rien à indexer : aucun appel au service d'embeddings", async () => {
    expect(await indexerUnLot()).toEqual({ indexes: 0, echecs: 0 });
    expect(hoisted.embedLots).not.toHaveBeenCalled();
  });

  it("une source inattendue (ex. messages de prospects) n'est jamais envoyée au service", async () => {
    hoisted.lignes = [ligne("reponse_prospect", 9, "secret"), ligne("note", 1, "a")];
    hoisted.embedLots.mockResolvedValue([[1]]);
    await indexerUnLot();
    expect(hoisted.embedLots).toHaveBeenCalledWith(["a"], expect.anything());
  });

  it("la limite passe dans la requête", async () => {
    await indexerUnLot(5);
    expect(rendre(hoisted.executes[0]).params).toContain(5);
  });
});

describe("passerIndexeur", () => {
  it("jamais deux passages en parallèle", async () => {
    let liberer!: () => void;
    hoisted.bloquer = new Promise<void>((ok) => { liberer = ok; });
    const p1 = passerIndexeur();
    const p2 = passerIndexeur();
    await p2;
    expect(hoisted.executes).toHaveLength(1);
    liberer();
    await p1;
    hoisted.bloquer = null;
    await passerIndexeur();
    expect(hoisted.executes).toHaveLength(2);
  });

  it("une erreur est journalisée, jamais levée", async () => {
    hoisted.lignes = [{ source: "note", source_id: 1, user_id: "u1", texte: "a", md5: "m" }];
    hoisted.embedLots.mockRejectedValue(new Error("boum"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(passerIndexeur()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
