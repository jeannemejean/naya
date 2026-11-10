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
