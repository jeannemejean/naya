// Tests de rangerSouvenir et de son annulation, de bout en bout sur une FAUSSE base en mémoire :
// aucun test ne touche une vraie base ni OpenAI (consigne projet). La fausse base lit les
// requêtes SQL telles que Drizzle les rend (PgDialect) et applique leurs filtres sur ses lignes —
// ainsi `retrieveMemories` (le vrai code) retrouve, ou pas, la ligne que `rangerSouvenir` a écrite.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const f = vi.hoisted(() => ({ lignes: [] as any[], suite: 1 }));
const e = vi.hoisted(() => ({ embedText: vi.fn() }));
const d = vi.hoisted(() => ({ getAction: vi.fn(), marquerAnnulee: vi.fn() }));

vi.mock("../../db", () => {
  const dialecte = new PgDialect();
  return {
    db: {
      insert: () => ({
        values: (v: any) => ({
          returning: async () => {
            const ligne = { id: f.suite++, supersededAt: null, createdAt: new Date(), ...v };
            f.lignes.push(ligne);
            return [{ id: ligne.id }];
          },
        }),
      }),
      execute: async (requete: any) => {
        const { sql: texte, params } = dialecte.sqlToQuery(requete);
        const t = texte.replace(/\s+/g, " ").trim();
        if (t.startsWith("SELECT 1 FROM memory_entries")) {
          return { rows: f.lignes.filter((l) => l.userId === params[0] && !l.supersededAt) };
        }
        if (t.includes("SELECT m.id")) {
          // params : userId, fil, [projet]. La portée suit le SQL rendu.
          const [userId, fil, projet] = params;
          const rows = f.lignes
            .filter((l) => l.userId === userId && l.fil === fil && !l.supersededAt)
            .filter((l) => (t.includes("m.project_id IS NULL OR") ? l.projectId == null || l.projectId === projet
              : t.includes("IS NOT DISTINCT FROM") ? (l.projectId ?? null) === (projet ?? null) : l.projectId == null))
            .map((l) => ({ id: l.id, content: l.content, entryType: l.entryType, salience: l.salience, ageDays: 0, distance: null }));
          return { rows };
        }
        if (t.startsWith("UPDATE memory_entries SET superseded_at")) {
          const [id, userId] = params;
          const l = f.lignes.find((x) => x.id === id && x.userId === userId && !x.supersededAt);
          if (l) l.supersededAt = new Date();
          return { rows: [] };
        }
        if (t.includes("FROM memory_entries WHERE id")) {
          const [id, userId] = params;
          return { rows: f.lignes.filter((x) => x.id === id && x.userId === userId) };
        }
        throw new Error(`requête inattendue : ${t}`);
      },
    },
  };
});
vi.mock("./embed", () => ({ embedText: e.embedText, toVectorLiteral: (v: number[]) => `[${v.join(",")}]` }));
vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../agent/depot", () => ({ depot: d }));

const { rangerSouvenir, SALIENCE_SOUVENIR } = await import("./ranger");
const { retrieveMemories } = await import("./retrieve");
const { annulerAction } = await import("../agent/journal");

beforeEach(() => {
  f.lignes = []; f.suite = 1;
  vi.clearAllMocks();
  e.embedText.mockResolvedValue(null);
});

describe("rangerSouvenir", () => {
  it("écrit la ligne : salience 0.6, fil et type donnés, embedding du texte", async () => {
    e.embedText.mockResolvedValue([0.1, 0.2]);
    const r = await rangerSouvenir("u1", 7, "JMD ne publie jamais le lundi", "cap", "préférence");
    expect(r).toEqual({ id: 1 });
    expect(f.lignes[0]).toMatchObject({
      userId: "u1", projectId: 7, fil: "cap", entryType: "préférence",
      content: "JMD ne publie jamais le lundi", salience: SALIENCE_SOUVENIR, embedding: [0.1, 0.2],
    });
    expect(SALIENCE_SOUVENIR).toBe(0.6);
  });

  it("sans embedding disponible : la ligne est écrite avec embedding null", async () => {
    await rangerSouvenir("u1", null, "Elle travaille mieux le matin", "founder", "fait");
    expect(f.lignes[0].embedding).toBeNull();
  });

  it("l'embedding qui lève n'empêche pas l'écriture", async () => {
    e.embedText.mockRejectedValue(new Error("openai down"));
    await rangerSouvenir("u1", null, "x", "founder", "fait");
    expect(f.lignes).toHaveLength(1);
  });

  it("ressort dans retrieveMemories (sans embedding), puis plus après l'annulation", async () => {
    const { id } = await rangerSouvenir("u1", 7, "JMD ne publie jamais le lundi", "cap", "préférence");
    let m = await retrieveMemories("u1", 7, undefined, ["cap"]);
    expect(m.cap.map((x) => x.content)).toEqual(["JMD ne publie jamais le lundi"]);
    // Une autre marque ou une autre utilisatrice ne la voit pas.
    expect((await retrieveMemories("u1", 8, undefined, ["cap"])).cap).toHaveLength(0);
    expect((await retrieveMemories("u2", 7, undefined, ["cap"])).cap).toHaveLength(0);

    // Annulation par le journal : superseded_at posé, la ligne reste en base.
    d.getAction.mockResolvedValue({
      id: 9, userId: "u1", createdAt: new Date("2026-11-02T10:00:00Z"), annuleeAt: null,
      lignes: [{ table: "memory_entries", id, avant: null, apres: { content: "JMD ne publie jamais le lundi", supersededAt: null } }],
    });
    const r = await annulerAction("u1", 9, new Date("2026-11-02T11:00:00Z"));
    expect(r).toEqual({ ok: true });
    expect(f.lignes).toHaveLength(1);
    expect(f.lignes[0].supersededAt).toBeInstanceOf(Date);
    m = await retrieveMemories("u1", 7, undefined, ["cap"]);
    expect(m.cap).toHaveLength(0);
    expect(d.marquerAnnulee).toHaveBeenCalled();
  });

  it("un souvenir déjà périmé depuis : l'annulation est refusée (modifiee)", async () => {
    const { id } = await rangerSouvenir("u1", null, "fait", "founder", "fait");
    f.lignes[0].supersededAt = new Date();
    d.getAction.mockResolvedValue({
      id: 9, userId: "u1", createdAt: new Date("2026-11-02T10:00:00Z"), annuleeAt: null,
      lignes: [{ table: "memory_entries", id, avant: null, apres: { content: "fait", supersededAt: null } }],
    });
    expect(await annulerAction("u1", 9, new Date("2026-11-02T11:00:00Z"))).toEqual({ ok: false, raison: "modifiee" });
  });

  it("le souvenir d'une autre utilisatrice n'est jamais touché par l'annulation", async () => {
    const { id } = await rangerSouvenir("u2", null, "à elle", "founder", "fait");
    d.getAction.mockResolvedValue({
      id: 9, userId: "u1", createdAt: new Date("2026-11-02T10:00:00Z"), annuleeAt: null,
      lignes: [{ table: "memory_entries", id, avant: null, apres: { content: "à elle", supersededAt: null } }],
    });
    expect(await annulerAction("u1", 9, new Date("2026-11-02T11:00:00Z"))).toEqual({ ok: false, raison: "modifiee" });
    expect(f.lignes[0].supersededAt).toBeNull();
  });
});
