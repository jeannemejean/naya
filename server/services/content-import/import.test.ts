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
import { PgDialect } from "drizzle-orm/pg-core";

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

// Motif de collision.test.ts : rendre une clause en SQL réel pour affirmer un tri ou un
// filtre à la lettre, plutôt que de faire confiance à ce que le simulacre a bien voulu
// transmettre.
const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

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
    // title et body bien mappés chacun sur son propre champ (titre → title, corps →
    // body) : les intervertir laisserait passer ce test si seuls projectId/status/
    // contentStatus étaient vérifiés.
    expect(lignes[0].title).toBe("Premier post");
    expect(lignes[0].body).toBe("Corps par défaut, assez long pour ressembler à un vrai post collé ici.");
    expect(lignes[1].title).toBe("Second post");
    expect(lignes[1].body).toBe("Corps par défaut, assez long pour ressembler à un vrai post collé ici.");
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
    // Capturé avant l'appel : `resultatsTransaction` est consommé par `.shift()`.
    const lignesRendues = [{ id: 1, title: "Post transactionnel", scheduledFor: null }];
    hoisted.resultatsTransaction = [lignesRendues];

    const r = await importerTexte(INPUT);

    expect(hoisted.transactionAppelee).toBe(true);
    expect(hoisted.tablesInserees[0]).toBe(content);
    // Ce que rend `importerTexte` est bien ce que la transaction a rendu — sans cette
    // assertion, ce test ne verrait pas un retour de transaction ignoré ; il ne dépend
    // plus des cas 1/9a/9b pour le garantir.
    expect(r.posts).toEqual(lignesRendues);
  });

  it("la projection du retour inclut `body` : la détection de collision du lot (routes.ts) compare des ANGLES, qui vivent dans le corps, pas le titre", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Un titre", corps: "Le corps réel du post, distinct du titre." })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[
      { id: 1, title: "Un titre", body: "Le corps réel du post, distinct du titre.", scheduledFor: null },
    ]];

    const r = await importerTexte(INPUT);

    // La projection ENVOYÉE à `.returning()` demande `body` — sans elle, le corps ne
    // remonterait jamais jusqu'à l'appelante, qui ne pourrait alors comparer que des
    // titres pour juger une collision d'angle (voir le commentaire de
    // `detecterCollision` dans services/brand-links/collision.ts).
    expect(hoisted.projectionsRetournees[0]).toHaveProperty("body");
    expect(r.posts[0].body).toBe("Le corps réel du post, distinct du titre.");
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

  it("la requête de plateforme majoritaire trie par date de création décroissante et plafonne à 200 — sans ça, le résultat dépendrait de l'ordre physique rendu par Postgres, et deux imports du même texte combleraient différemment", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "Post quelconque", plateforme: null })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post quelconque", scheduledFor: null }]];

    await importerTexte(INPUT);

    // Un seul `orderBy` est posé dans tout l'appel : celui de la requête des
    // plateformes récentes. L'autre select (les titres existants) n'en pose pas.
    expect(hoisted.orderBys).toHaveLength(1);
    const tri = enSql(hoisted.orderBys[0][0]);
    expect(tri.sql).toContain('"content"."created_at"');
    expect(tri.sql.toLowerCase()).toContain("desc");

    // 200 = CONTENUS_CONSULTES_PLATEFORME dans import.ts — constante interne, non
    // exportée (le brief ne la fait pas sortir du module).
    expect(hoisted.limits).toContain(200);
  });

  it("le journal annonce le nombre de posts ÉCRITS, pas le nombre extrait avant déduplication — sinon un import avec des ignorés annoncerait des posts qui n'ont pas été créés", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([
        posteModele({ titre: "Post nouveau" }),
        posteModele({ titre: "Post déjà existant" }),
      ]),
    );
    // Le second titre existe déjà dans la marque : UN SEUL post est réellement écrit,
    // l'autre est ignoré — mais extraits.length vaut 2.
    hoisted.resultats = [[], [{ title: "Post déjà existant" }]];
    hoisted.resultatsTransaction = [[{ id: 1, title: "Post nouveau", scheduledFor: null }]];

    await importerTexte(INPUT);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const message = infoSpy.mock.calls[0][0] as string;
    expect(message).toContain(`projet ${INPUT.projectId}`);
    expect(message).toContain("1 post(s) écrit(s)");
    expect(message).toContain("1 ignoré(s)");
    // Le piège visé : journaliser extraits.length (2) au lieu de posts.length (1)
    // annoncerait deux posts écrits alors qu'un seul l'a été.
    expect(message).not.toContain("2 post(s) écrit(s)");
  });

  it("le journal mentionne la réécriture quand la couverture dépasse 1,2 (SEUIL_REECRITURE)", async () => {
    const texte = "x"; // texte minuscule : l'extrait est forcément bien plus long que lui
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({
        titre: "Un titre nettement plus long que le texte original collé ici",
        corps: "Et un corps nettement plus long également, de loin, pour dépasser le seuil.",
      })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "t", scheduledFor: null }]];

    const r = await importerTexte({ ...INPUT, texte });

    const message = infoSpy.mock.calls[0][0] as string;
    expect(message).toContain("le modèle a probablement réécrit au lieu d'extraire");
    expect(r.reecrit).toBe(true);
  });

  it("le journal ne mentionne PAS la réécriture quand la couverture reste sous 1,2", async () => {
    const texte = "x".repeat(1000); // texte long : l'extrait court reste largement sous lui
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "t", corps: "c" })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "t", scheduledFor: null }]];

    const r = await importerTexte({ ...INPUT, texte });

    const message = infoSpy.mock.calls[0][0] as string;
    expect(message).not.toContain("le modèle a probablement réécrit au lieu d'extraire");
    expect(r.reecrit).toBe(false);
  });

  it("mesurerCouverture ne compte que le CORPS, pas le titre — un titre synthétisé énorme ne doit pas masquer un corps peu fidèle", async () => {
    const texte = "z".repeat(500);
    (claude.callClaudeDetailed as any).mockResolvedValue(
      reponseModele([posteModele({ titre: "x".repeat(500), corps: "y".repeat(5) })]),
    );
    hoisted.resultats = [[], []];
    hoisted.resultatsTransaction = [[{ id: 1, title: "t", scheduledFor: null }]];

    const r = await importerTexte({ ...INPUT, texte });

    // Si le titre comptait, couverture serait ~1 (500+5)/500 ; en ne comptant que le
    // corps, elle doit être proche de 5/500 = 0.01.
    expect(r.couverture).toBeCloseTo(0.01, 2);
    expect(r.reecrit).toBe(false);
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
