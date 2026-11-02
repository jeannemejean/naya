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

vi.mock("../memory/embed", () => ({
  embedTextsParLots: hoisted.embedLots,
  embedText: vi.fn(),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { indexerUnLot, passerIndexeur, requeteCandidats, TEXTE_MAX } from "./indexeur";

const dialecte = new PgDialect();
const rendre = (q: any) => dialecte.sqlToQuery(q);

beforeEach(() => {
  hoisted.executes.length = 0;
  hoisted.lignes = [];
  hoisted.inserts.length = 0;
  hoisted.conflits.length = 0;
  hoisted.embedLots.mockReset();
  hoisted.bloquer = null;
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
