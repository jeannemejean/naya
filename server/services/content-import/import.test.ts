// Tests de l'orchestration de l'import d'un texte collé en posts du calendrier éditorial.
//
// `../../db` est mocké sur le motif de `server/services/brand-links/collision.test.ts`
// pour ne JAMAIS toucher la vraie base (DATABASE_URL de .env pointe vers une base Neon
// réelle — consigne projet : aucun test n'exécute de requête réelle). Le mock reprend la
// chaîne thenable « tout accepte » de `collision.test.ts` (capture de `from`/`where`/
// `orderBy`/`limit`, file de résultats qui simule aussi une panne), et l'ÉTEND pour couvrir
// `db.transaction` — aucun test de ce dépôt ne le moque, l'écriture de l'import en a besoin.
//
// `../claude` est mocké sur le motif de `server/services/sequence-message.test.ts` : seul
// l'appel (`callClaudeDetailed`) est remplacé, `CLAUDE_MODELS` reste réel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  // Chaîne de select, motif repris tel quel de collision.test.ts.
  resultats: [] as any[],
  selects: [] as any[],
  froms: [] as any[],
  wheres: [] as any[],
  orderBys: [] as any[],
  limits: [] as any[],
  // Extension propre à ce test : db.transaction.
  transactionAppelee: false,
  tablesInserees: [] as any[],
  lignesInserees: [] as any[],
  projectionsRetournees: [] as any[],
  resultatsTransaction: [] as any[],
}));

vi.mock("../../db", () => {
  // Chaîne de constructeur de requête « tout accepte », attendable (thenable) — motif
  // identique à collision.test.ts : elle rend le prochain résultat de la file, ou
  // rejette si c'est une erreur (simule une base qui tombe en panne).
  const chaine = (): any => {
    const suite: any = {
      from: (table: any) => {
        hoisted.froms.push(table);
        return suite;
      },
      where: (clause: any) => {
        hoisted.wheres.push(clause);
        return suite;
      },
      orderBy: (...args: any[]) => {
        hoisted.orderBys.push(args);
        return suite;
      },
      limit: (n: any) => {
        hoisted.limits.push(n);
        return suite;
      },
      then: (ok: any, ko: any) =>
        Promise.resolve()
          .then(() => {
            const r = hoisted.resultats.shift();
            if (r instanceof Error) throw r;
            return r ?? [];
          })
          .then(ok, ko),
    };
    return suite;
  };
  return {
    db: {
      select: (projection?: any) => {
        hoisted.selects.push(projection);
        return chaine();
      },
      // Extension : `tx.insert(table).values(rows).returning(projection)`. La forme
      // exacte attendue par import.ts — un seul insert groupé par transaction.
      transaction: async (callback: any) => {
        hoisted.transactionAppelee = true;
        const tx = {
          insert: (table: any) => {
            hoisted.tablesInserees.push(table);
            return {
              values: (lignes: any) => {
                hoisted.lignesInserees.push(lignes);
                return {
                  returning: (projection: any) => {
                    hoisted.projectionsRetournees.push(projection);
                    const r = hoisted.resultatsTransaction.shift();
                    if (r instanceof Error) return Promise.reject(r);
                    return Promise.resolve(r ?? []);
                  },
                };
              },
            };
          },
        };
        return callback(tx);
      },
    },
  };
});

vi.mock("../claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaudeDetailed: vi.fn() };
});

const { content } = await import("@shared/schema");
const claude = await import("../claude");
const { PLATEFORME_PAR_DEFAUT } = await import("./parse");
const { importerTexte, ReponseIllisible } = await import("./import");

/** Un post tel que rendu par le modèle (forme `PostExtrait`). */
function posteModele(over: Record<string, unknown> = {}) {
  return {
    titre: "Titre par défaut",
    corps: "Corps par défaut, assez long pour ressembler à un vrai post collé ici.",
    plateforme: null,
    type: null,
    pilier: null,
    objectif: null,
    date: null,
    ...over,
  };
}

/** Ce que rend `callClaudeDetailed` : le texte brut (tableau JSON) et le stopReason. */
function reponseModele(posts: unknown[], stopReason?: string) {
  return { text: JSON.stringify(posts), stopReason };
}

describe("importerTexte", () => {
  const INPUT = { userId: "user-1", projectId: 7, texte: "le texte collé par l'utilisatrice" };

  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hoisted.resultats = [];
    hoisted.selects = [];
    hoisted.froms = [];
    hoisted.wheres = [];
    hoisted.orderBys = [];
    hoisted.limits = [];
    hoisted.transactionAppelee = false;
    hoisted.tablesInserees = [];
    hoisted.lignesInserees = [];
    hoisted.projectionsRetournees = [];
    hoisted.resultatsTransaction = [];
    vi.clearAllMocks();
    // Restaurée dans afterEach : un spy non restauré fait fuir l'historique des appels
    // d'un test à l'autre et produit des échecs trompeurs — piège déjà rencontré sur ce
    // chantier (voir collision.test.ts).
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("cas 1 — un texte produisant deux posts écrit deux lignes, avec le projectId reçu, status draft et contentStatus idea", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Premier post" }), posteModele({ titre: "Second post" })]),
    );
    hoisted.resultats = [[], []]; // aucune plateforme récente, aucun titre existant
    hoisted.resultatsTransaction = [[
      { id: 1, title: "Premier post", scheduledFor: null },
      { id: 2, title: "Second post", scheduledFor: null },
    ]];

    const r = await importerTexte(INPUT);

    expect(r.posts).toHaveLength(2);
    expect(hoisted.lignesInserees).toHaveLength(1); // un seul insert groupé
    const lignes = hoisted.lignesInserees[0];
    expect(lignes).toHaveLength(2);
    for (const ligne of lignes) {
      expect(ligne.projectId).toBe(INPUT.projectId);
      expect(ligne.status).toBe("draft");
      expect(ligne.contentStatus).toBe("idea");
    }
  });

  it("cas 2 — un post sans plateforme reçoit la plateforme majoritaire de la marque, et deducedFields contient platform", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post sans plateforme", plateforme: null })]),
    );
    hoisted.resultats = [
      [{ platform: "instagram" }, { platform: "instagram" }, { platform: "linkedin" }], // majorité instagram
      [],
    ];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post sans plateforme", scheduledFor: null }]];

    await importerTexte(INPUT);

    const ligne = hoisted.lignesInserees[0][0];
    expect(ligne.platform).toBe("instagram");
    expect(ligne.deducedFields).toContain("platform");
  });

  it("cas 3 — un post dont le modèle a tout donné a deducedFields égal à [] (pas null)", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post complet", plateforme: "tiktok", type: "reel" })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post complet", scheduledFor: null }]];

    await importerTexte(INPUT);

    expect(hoisted.lignesInserees[0][0].deducedFields).toEqual([]);
  });

  it("cas 4 — un post sans date est écrit avec scheduledFor à null", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post sans date", date: null })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post sans date", scheduledFor: null }]];

    await importerTexte(INPUT);

    expect(hoisted.lignesInserees[0][0].scheduledFor).toBeNull();
  });

  it("cas 5 — un titre déjà présent dans la marque n'est PAS écrit, et ignores vaut 1", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Café du lundi" })]),
    );
    // Même titre une fois normalisé (accents, casse, ponctuation) : la dédoublonnage
    // doit passer par `normalizeTitle`, pas par une égalité stricte de chaînes.
    hoisted.resultats = [[], [{ title: "cafe du lundi !" }]];

    const r = await importerTexte(INPUT);

    expect(r.posts).toEqual([]);
    expect(r.ignores).toBe(1);
    expect(hoisted.transactionAppelee).toBe(false); // rien à écrire : pas de transaction
  });

  it("cas 6 — deux posts du même titre dans le même lot n'écrivent qu'une ligne, et ignores vaut 1", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([
        posteModele({ titre: "Mon post phare" }),
        posteModele({ titre: "mon post phare" }), // même titre normalisé, à l'intérieur du lot
      ]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Mon post phare", scheduledFor: null }]];

    const r = await importerTexte(INPUT);

    expect(hoisted.lignesInserees[0]).toHaveLength(1);
    expect(r.ignores).toBe(1);
  });

  it("cas 7 — une réponse de modèle illisible n'écrit RIEN et lève — l'appelant transforme en 502", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: "désolée, je ne comprends pas ce texte",
      stopReason: "end_turn",
    });

    await expect(importerTexte(INPUT)).rejects.toThrow(ReponseIllisible);
    expect(hoisted.froms).toEqual([]); // aucune requête select tentée
    expect(hoisted.transactionAppelee).toBe(false);
  });

  it("cas 8 — un tableau vide ([]) n'écrit rien, ne lève PAS, et rend posts: [] — un résultat, pas une panne", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModele([]));
    hoisted.resultats = [[], []];

    const r = await importerTexte(INPUT);

    expect(r.posts).toEqual([]);
    expect(r.ignores).toBe(0);
    expect(hoisted.transactionAppelee).toBe(false);
  });

  it("cas 9a — stopReason 'max_tokens' met tronque à true sans empêcher l'écriture des posts obtenus", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post malgré troncature" })], "max_tokens"),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post malgré troncature", scheduledFor: null }]];

    const r = await importerTexte(INPUT);

    expect(r.tronque).toBe(true);
    expect(r.posts).toHaveLength(1);
  });

  it("cas 9b — stopReason 'length' (convention OpenAI) met AUSSI tronque à true : deux valeurs, pas une", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post malgré troncature OpenAI" })], "length"),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post malgré troncature OpenAI", scheduledFor: null }]];

    const r = await importerTexte(INPUT);

    expect(r.tronque).toBe(true);
    expect(r.posts).toHaveLength(1);
  });

  it("cas 9c — un stopReason qui n'indique pas de troncature laisse tronque à false", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post complet, non tronqué" })], "end_turn"),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post complet, non tronqué", scheduledFor: null }]];

    const r = await importerTexte(INPUT);

    expect(r.tronque).toBe(false);
  });

  it("cas 10 — l'écriture passe par db.transaction", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post transactionnel" })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post transactionnel", scheduledFor: null }]];

    await importerTexte(INPUT);

    expect(hoisted.transactionAppelee).toBe(true);
    expect(hoisted.tablesInserees[0]).toBe(content);
  });

  it("cas 11 — une marque sans aucun contenu existant donne linkedin comme plateforme par défaut", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post sans historique", plateforme: null })]),
    );
    hoisted.resultats = [[], []]; // aucun contenu récent du tout
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post sans historique", scheduledFor: null }]];

    await importerTexte(INPUT);

    expect(hoisted.lignesInserees[0][0].platform).toBe(PLATEFORME_PAR_DEFAUT);
    expect(PLATEFORME_PAR_DEFAUT).toBe("linkedin");
  });

  it("décisions — appelle callClaudeDetailed avec taskKind 'strategic_reasoning' (pas 'extraction') et le modèle smart", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModele([]));
    hoisted.resultats = [[], []];

    await importerTexte(INPUT);

    const appel = (claude.callClaudeDetailed as any).mock.calls[0][0];
    expect(appel.taskKind).toBe("strategic_reasoning");
    expect(appel.model).toBe((claude as any).CLAUDE_MODELS.smart);
  });
});
