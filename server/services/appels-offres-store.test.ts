// upsertDepuisVeille : ce qu'il écrit, ce qu'il ne réécrit jamais. Base factice, aucune connexion.
import { describe, it, expect, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";

vi.mock("../db", () => ({ db: {} }));
const { upsertDepuisVeille } = await import("./appels-offres-store");

function fausseBase() {
  const appels: Array<{ table: string; values: any; conflit: any }> = [];
  const tx = {
    insert: (table: any) => ({
      values: (values: any) => ({
        onConflictDoUpdate: async (conflit: any) => { appels.push({ table: getTableName(table), values, conflit }); },
      }),
    }),
  };
  const db = { transaction: vi.fn(async (fn: (t: any) => Promise<void>) => fn(tx)) };
  return { db: db as any, appels };
}

const ligne = (over: Record<string, unknown> = {}) => ({
  objet: "Communication 2027", statut: "premier_jet_pret" as const, notes: "note veille",
  offresJmd: ["IN SCENA"], source: "notion_import", sourceId: "abc", ...over,
});

describe("upsertDepuisVeille", () => {
  it("insère tout pour une ligne neuve, mais ne réécrit ni statut ni notes sur une existante", async () => {
    const { db, appels } = fausseBase();
    const r = await upsertDepuisVeille("user-1", [ligne()], { projectId: 7 }, db);
    expect(r.ecrites).toBe(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const [a] = appels;
    expect(a.table).toBe("appels_offres");
    expect(a.values).toMatchObject({ userId: "user-1", projectId: 7, statut: "premier_jet_pret", notes: "note veille" });
    expect(a.conflit.set).not.toHaveProperty("statut");
    expect(a.conflit.set).not.toHaveProperty("notes");
    expect(a.conflit.set).not.toHaveProperty("userId");
    expect(a.conflit.set).toMatchObject({ objet: "Communication 2027", projectId: 7 });
    expect(a.conflit.target).toHaveLength(3);
  });

  it("sans projet : garde celui déjà en base (expression SQL, pas null)", async () => {
    const { db, appels } = fausseBase();
    await upsertDepuisVeille("user-1", [ligne()], {}, db);
    expect(appels[0].values.projectId).toBeNull();
    const p = appels[0].conflit.set.projectId as SQL;
    expect(p).not.toBeNull();
    expect(typeof p).toBe("object");
  });

  it("refuse une ligne sans source_id, avant toute écriture", async () => {
    const { db, appels } = fausseBase();
    await expect(upsertDepuisVeille("user-1", [ligne(), ligne({ sourceId: "" })], {}, db)).rejects.toThrow(/source_id/);
    await expect(upsertDepuisVeille("user-1", [ligne({ sourceId: null })] as any, {}, db)).rejects.toThrow(/source_id/);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(appels).toHaveLength(0);
  });

  it("refuse sans utilisatrice", async () => {
    const { db } = fausseBase();
    await expect(upsertDepuisVeille("", [ligne()], {}, db)).rejects.toThrow(/userId/);
  });
});

describe("rafraichirDepuisVeille", () => {
  function baseMaj() {
    const maj: Array<{ table: string; set: any; where: unknown }> = [];
    const db = {
      update: (table: any) => ({
        set: (set: any) => ({
          where: (where: unknown) => ({ returning: async () => { maj.push({ table: getTableName(table), set, where }); return [{ id: 1 }]; } }),
        }),
      }),
    };
    return { db: db as any, maj };
  }

  it("n'écrit que les faits fournis : jamais statut, notes ni qualification", async () => {
    const { rafraichirDepuisVeille } = await import("./appels-offres-store");
    const { db, maj } = baseMaj();
    const faits = { dateLimite: new Date("2026-12-07T22:59:00Z"), montantEstimeHt: "250000.00", lienDce: "", statut: "ecarte", notes: "x", scoreAdequation: "fort" } as any;
    expect(await rafraichirDepuisVeille("user-1", 4, faits, {}, db)).toBe(true);
    expect(maj[0].table).toBe("appels_offres");
    expect(Object.keys(maj[0].set).sort()).toEqual(["dateLimite", "montantEstimeHt", "updatedAt"]);
  });

  it("rien à écrire : aucune requête", async () => {
    const { rafraichirDepuisVeille } = await import("./appels-offres-store");
    const { db, maj } = baseMaj();
    expect(await rafraichirDepuisVeille("user-1", 4, {}, {}, db)).toBe(false);
    expect(maj).toHaveLength(0);
  });

  it("ligne Notion (seulementVides) : chaque fait passe par coalesce, jamais une valeur brute qui écraserait", async () => {
    const { rafraichirDepuisVeille } = await import("./appels-offres-store");
    const { db, maj } = baseMaj();
    await rafraichirDepuisVeille("user-1", 4, { dateLimite: new Date("2026-12-07T22:59:00Z"), departement: "92" }, { seulementVides: true }, db);
    const set = maj[0].set;
    for (const k of ["dateLimite", "departement"]) {
      expect(set[k]).not.toBeInstanceOf(Date);
      expect(typeof set[k]).toBe("object");
      expect(JSON.stringify(set[k].queryChunks?.map((c: any) => c?.value ?? "")) ?? "").toContain("coalesce(");
    }
  });
});
