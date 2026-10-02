import { describe, it, expect } from "vitest";
import {
  contenuEstPublie, tacheEstFaite, trierContenus, trierTaches,
  construirePreference, SALIENCE_REJET,
} from "./rejeter";

const nu = { id: 1, publishedAt: null, postStatus: null, contentStatus: null };

describe("contenuEstPublie — on garde dès qu'UN signal est allumé", () => {
  it("rend faux quand aucun signal n'est allumé", () => {
    expect(contenuEstPublie(nu)).toBe(false);
  });

  it("rend vrai sur publishedAt seul", () => {
    expect(contenuEstPublie({ ...nu, publishedAt: new Date("2026-09-01") })).toBe(true);
  });

  it("rend vrai sur postStatus = posted seul", () => {
    expect(contenuEstPublie({ ...nu, postStatus: "posted" })).toBe(true);
  });

  it("rend vrai sur contentStatus = published seul", () => {
    expect(contenuEstPublie({ ...nu, contentStatus: "published" })).toBe(true);
  });

  it("ne confond pas les états intermédiaires de postStatus avec une publication", () => {
    for (const s of ["pending", "uploading", "processing", "posting", "failed"]) {
      expect(contenuEstPublie({ ...nu, postStatus: s })).toBe(false);
    }
  });

  it("ne confond pas les étapes amont de contentStatus avec une publication", () => {
    for (const s of ["idea", "draft", "ready"]) {
      expect(contenuEstPublie({ ...nu, contentStatus: s })).toBe(false);
    }
  });

  it("normalise la casse et les espaces avant de comparer", () => {
    // Variantes de casse qui devraient être reconnues comme publication
    expect(contenuEstPublie({ ...nu, postStatus: "Posted" })).toBe(true);
    expect(contenuEstPublie({ ...nu, postStatus: "POSTED" })).toBe(true);
    expect(contenuEstPublie({ ...nu, postStatus: " posted " })).toBe(true);
    expect(contenuEstPublie({ ...nu, contentStatus: "Published" })).toBe(true);
    expect(contenuEstPublie({ ...nu, contentStatus: "PUBLISHED" })).toBe(true);
    expect(contenuEstPublie({ ...nu, contentStatus: " published " })).toBe(true);
  });
});

describe("tacheEstFaite", () => {
  it("suit completed", () => {
    expect(tacheEstFaite({ id: 1, completed: true })).toBe(true);
    expect(tacheEstFaite({ id: 1, completed: false })).toBe(false);
  });
});

describe("trierContenus", () => {
  it("sépare les gardés des partants", () => {
    const tri = trierContenus([
      { id: 10, publishedAt: new Date("2026-09-01"), postStatus: null, contentStatus: null },
      { id: 11, publishedAt: null, postStatus: "posted", contentStatus: null },
      { id: 12, publishedAt: null, postStatus: null, contentStatus: "published" },
      { id: 13, publishedAt: null, postStatus: "pending", contentStatus: "draft" },
      { id: 14, publishedAt: null, postStatus: null, contentStatus: "idea" },
    ]);
    expect(tri.gardes).toEqual([10, 11, 12]);
    expect(tri.partants).toEqual([13, 14]);
  });

  it("rend deux listes vides sur une entrée vide, sans jeter", () => {
    expect(trierContenus([])).toEqual({ gardes: [], partants: [] });
  });
});

describe("trierTaches", () => {
  it("sépare les faites des non faites", () => {
    const tri = trierTaches([
      { id: 20, completed: true },
      { id: 21, completed: false },
      { id: 22, completed: true },
    ]);
    expect(tri.gardes).toEqual([20, 22]);
    expect(tri.partants).toEqual([21]);
  });
});

describe("construirePreference", () => {
  const campagne = { name: "De Stratège à Scène", objective: "asseoir l'autorité", coreMessage: "la stratège monte sur scène" };

  it("rend une phrase qui se tient SEULE, sans son contexte d'origine", () => {
    // Une entrée de mémoire est relue des mois plus tard, mêlée à d'autres, hors de
    // tout contexte. « Je ne veux pas ça » y serait illisible.
    const p = construirePreference({ campagne, raison: "trop centré sur moi, pas assez sur les clientes" });
    expect(p).toContain("De Stratège à Scène");
    expect(p).toContain("trop centré sur moi, pas assez sur les clientes");
    // Vérifier la structure : guillemets autour du nom, phrases de liaison
    expect(p).toContain("« De Stratège à Scène »");
    expect(p).toContain("Ce qui n'allait pas");
    expect(p.length).toBeGreaterThan(40);
  });

  it("inclut l'objectif et le message central, qui sont ce que Naya doit éviter", () => {
    const p = construirePreference({ campagne, raison: "non" });
    expect(p).toContain("asseoir l'autorité");
    expect(p).toContain("la stratège monte sur scène");
    // Vérifier que ces éléments sont dans des phrases structurées, pas une concaténation brute
    expect(p).toContain("Son objectif était : asseoir l'autorité");
    expect(p).toContain("Son message central était : la stratège monte sur scène");
  });

  it("finit toujours par un point, même si la raison n'en porte pas", () => {
    const sans = construirePreference({ campagne, raison: "pas assez de détails" });
    expect(sans).not.toBeNull();
    expect(sans!.endsWith(".")).toBe(true);
    const avec = construirePreference({ campagne, raison: "trop court." });
    expect(avec).not.toBeNull();
    expect(avec!.endsWith("court.")).toBe(true);
  });

  it("rend null sur une raison vide ou blanche — pas de préférence sans raison", () => {
    expect(construirePreference({ campagne, raison: "" })).toBeNull();
    expect(construirePreference({ campagne, raison: "   " })).toBeNull();
  });

  it("supporte une campagne aux champs manquants sans produire « undefined »", () => {
    const p = construirePreference({ campagne: { name: "", objective: "", coreMessage: null }, raison: "pas ça" });
    expect(p).not.toBeNull();
    expect(p!).not.toContain("undefined");
    expect(p!).not.toContain("null");
  });
});

describe("la salience d'un rejet", () => {
  it("vaut 0,8 — plus qu'une observation déduite (défaut 0,5)", () => {
    expect(SALIENCE_REJET).toBe(0.8);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION — `rejeterCampagne`.
//
// `../../db` est mocké sur le motif de `server/services/content-import/import.test.ts`
// (chaîne thenable « tout accepte » + `db.transaction` moqué, qui existe déjà depuis le
// chantier précédent) pour ne JAMAIS toucher la vraie base (DATABASE_URL pointe vers une
// base Neon réelle). Le mock est ÉTENDU pour couvrir, À L'INTÉRIEUR de la transaction :
// `tx.select(...).from(...).leftJoin(...).where(...)` (lecture des articulations
// rompues), `tx.update(...).set(...).where(...)` (détachement), `tx.delete(...).where(...)`
// (suppression) et `tx.insert(...).values(...)` (préférence) — chacune poussant une
// étiquette dans `hoisted.ordre` pour pouvoir affirmer l'ORDRE RELATIF des opérations
// (brief, point 1), et chacune pouvant rejeter (file d'opérations qui accepte des
// `Error`) pour simuler une panne EN COURS de transaction (point 3 : rien ne doit
// survivre à un échec).
//
// `../memory/embed` est mocké à part : seul `embedText` est remplacé (motif
// `sequence-message.test.ts`), pour contrôler null/levée sans dépendre d'un provider.
import { vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
// `@shared/schema` n'est PAS mocké (seuls `../../db` et `../memory/embed` le sont) :
// import statique, donc disponible en dehors de toute temporalité de hoisting — la
// fabrique de `vi.mock("../../db", ...)` plus bas peut s'y référer en toute sécurité
// pour étiqueter les opérations par table visée.
import {
  content as TABLE_CONTENT, tasks as TABLE_TASKS, campaigns as TABLE_CAMPAIGNS, memoryEntries as TABLE_MEMORY,
  // Tables de la cascade de prospection (Important 1, revue finale du 2026-10-02) :
  // `storage.deleteProspectionCampaign`, appelée depuis `rejeter.ts` AVEC `tx` comme
  // exécuteur (pas de transaction imbriquée — voir les tests dédiés plus bas), touche
  // ces tables. Non mockées (même motif que les tables ci-dessus) : import statique.
  prospectionCampaigns as TABLE_PROSPECTION, leads as TABLE_LEADS, leadSequenceState as TABLE_LEAD_SEQ_STATE,
  outreachStepSends as TABLE_OUTREACH_SENDS, leadStepMessages as TABLE_LEAD_STEP_MSGS,
  campaignSequenceSteps as TABLE_SEQ_STEPS, prospectionUsage as TABLE_PROSPECTION_USAGE,
} from "@shared/schema";

const hoisted = vi.hoisted(() => ({
  // Lectures hors transaction (campagne, contenus, tâches) — une file FIFO unique,
  // dans l'ordre où `rejeterCampagne` les effectue.
  resultats: [] as any[],
  froms: [] as any[],
  wheres: [] as any[],

  // Transaction.
  transactionAppelee: false,
  transactionCount: 0,
  // Lecture des articulations rompues, À L'INTÉRIEUR de la transaction.
  resultatsArticulations: [] as any[],
  txFroms: [] as any[],
  txWheres: [] as any[],
  txLeftJoins: [] as any[],
  // Écritures À L'INTÉRIEUR de la transaction, dans l'ordre d'exécution.
  ordre: [] as string[],
  updates: [] as any[],
  deletes: [] as any[],
  inserts: [] as any[],
  // File d'opérations d'écriture (update/delete/insert) — une par opération déclenchée,
  // dans l'ordre. Un `Error` dans cette file simule une panne EN COURS de transaction.
  resultatsOps: [] as any[],
}));

vi.mock("../../db", () => {
  const chaine = (resultats: any[], froms: any[], wheres: any[]): any => {
    const suite: any = {
      from: (table: any) => {
        froms.push(table);
        return suite;
      },
      where: (clause: any) => {
        wheres.push(clause);
        return suite;
      },
      leftJoin: (table: any, clause: any) => {
        hoisted.txLeftJoins.push({ table, clause });
        return suite;
      },
      then: (ok: any, ko: any) =>
        Promise.resolve()
          .then(() => {
            const r = resultats.shift();
            if (r instanceof Error) throw r;
            return r ?? [];
          })
          .then(ok, ko),
    };
    return suite;
  };

  // Étiquette une opération d'écriture (update/delete/insert) selon la table visée —
  // c'est ce qui permet au test d'affirmer l'ORDRE sans dépendre d'un détail d'API.
  function etiquette(table: any, verbe: "detacher" | "supprimer" | "preference"): string {
    if (table === TABLE_CONTENT) return verbe === "detacher" ? "detacher-contenu" : "supprimer-contenu";
    if (table === TABLE_TASKS) return verbe === "detacher" ? "detacher-tache" : "supprimer-tache";
    // `campaigns` est à la fois UPDATE (délier le lien de prospection, cascade) et
    // DELETE (suppression finale, étape 5) — deux étiquettes distinctes, sinon les
    // tests de la cascade de prospection ne pourraient pas affirmer que l'une précède
    // l'autre.
    if (table === TABLE_CAMPAIGNS) return verbe === "detacher" ? "delier-prospection-sur-campagne" : "supprimer-campagne";
    if (table === TABLE_MEMORY) return "preference";
    // Tables touchées par la cascade de prospection (`storage.deleteProspectionCampaign`,
    // appelée avec `tx`) — chacune une étiquette propre, par le même motif.
    if (table === TABLE_LEADS) return "archiver-leads-prospection";
    if (table === TABLE_LEAD_SEQ_STATE) return "supprimer-lead-sequence-state";
    if (table === TABLE_OUTREACH_SENDS) return "supprimer-outreach-step-sends";
    if (table === TABLE_LEAD_STEP_MSGS) return "supprimer-lead-step-messages";
    if (table === TABLE_SEQ_STEPS) return "supprimer-campaign-sequence-steps";
    if (table === TABLE_PROSPECTION_USAGE) return "delier-prospection-usage";
    if (table === TABLE_PROSPECTION) return "supprimer-prospection-campaign";
    return `?${String(table)}`;
  }

  // Une opération d'écriture attendable : pousse son étiquette dans l'ordre, puis
  // consomme la file `resultatsOps` (une `Error` simule une panne À CET ENDROIT précis).
  function operation(label: string): any {
    return {
      then: (ok: any, ko: any) =>
        Promise.resolve()
          .then(() => {
            hoisted.ordre.push(label);
            const r = hoisted.resultatsOps.shift();
            if (r instanceof Error) throw r;
            return r ?? undefined;
          })
          .then(ok, ko),
    };
  }

  return {
    db: {
      select: (projection?: any) => {
        return chaine(hoisted.resultats, hoisted.froms, hoisted.wheres);
      },
      transaction: async (callback: any) => {
        hoisted.transactionAppelee = true;
        hoisted.transactionCount++;
        const tx: any = {
          select: (projection?: any) => {
            const suite = chaine(hoisted.resultatsArticulations, hoisted.txFroms, hoisted.txWheres);
            // Capture l'ordre au moment où CHAQUE lecture dans la transaction est
            // RÉSOLUE — l'étiquette dépend de la table interrogée (`.from(...)`,
            // déjà poussée dans `txFroms` au moment de construire la chaîne, donc
            // disponible ici) : la lecture des articulations (`campaigns`) doit
            // précéder toute écriture, comme avant ; les deux lectures internes de
            // `storage.deleteProspectionCampaign` (vérification de propriété sur
            // `prospectionCampaigns`, puis `campaignSequenceSteps` pour les messages à
            // purger) portent leur propre étiquette — SANS CECI, elles seraient
            // indiscernables de la lecture des articulations dans `ordre`.
            const table = hoisted.txFroms[hoisted.txFroms.length - 1];
            const label =
              table === TABLE_PROSPECTION ? "prospection-ownership-lue"
              : table === TABLE_SEQ_STEPS ? "prospection-stepids-lus"
              : "articulations-lues";
            const origThen = suite.then;
            suite.then = (ok: any, ko: any) =>
              origThen(
                (r: any) => {
                  hoisted.ordre.push(label);
                  return ok(r);
                },
                ko,
              );
            return suite;
          },
          update: (table: any) => ({
            set: (obj: any) => {
              hoisted.updates.push({ table, set: obj });
              return {
                where: (clause: any) => {
                  hoisted.updates[hoisted.updates.length - 1].where = clause;
                  return operation(etiquette(table, "detacher"));
                },
              };
            },
          }),
          delete: (table: any) => ({
            where: (clause: any) => {
              hoisted.deletes.push({ table, where: clause });
              return operation(etiquette(table, "supprimer"));
            },
          }),
          insert: (table: any) => ({
            values: (vals: any) => {
              hoisted.inserts.push({ table, values: vals });
              // `.returning({ id: ... })` — nécessaire depuis que `rejeterCampagne`
              // récupère l'id de la ligne insérée pour le journaliser (Important 2,
              // revue finale du 2026-10-02). Défaut `[{ id: undefined }]` quand le
              // test ne fournit rien dans `resultatsOps` : destructurable sans jeter,
              // comme avant pour tout test qui ne s'intéresse pas à cet id.
              return {
                returning: (_cols?: any) => ({
                  then: (ok: any, ko: any) =>
                    Promise.resolve()
                      .then(() => {
                        hoisted.ordre.push(etiquette(table, "preference"));
                        const r = hoisted.resultatsOps.shift();
                        if (r instanceof Error) throw r;
                        return r ?? [{ id: undefined }];
                      })
                      .then(ok, ko),
                }),
              };
            },
          }),
        };
        return callback(tx);
      },
    },
  };
});

vi.mock("../memory/embed", () => ({
  embedText: vi.fn(),
}));

// Alias locaux : mêmes objets que `TABLE_CONTENT` etc. ci-dessus (import statique,
// non mocké), nommés comme dans `rejeter.ts` pour la lisibilité des assertions.
const content = TABLE_CONTENT;
const tasks = TABLE_TASKS;
const campaigns = TABLE_CAMPAIGNS;
const memoryEntries = TABLE_MEMORY;
const prospectionCampaigns = TABLE_PROSPECTION;
const leads = TABLE_LEADS;
const embedModule = await import("../memory/embed");
const { rejeterCampagne, CampagneIntrouvable, SALIENCE_REJET: SALIENCE_REJET_ORCH } = await import("./rejeter");

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

const CAMPAGNE_LIGNE = {
  id: 42,
  name: "De Stratège à Scène",
  objective: "asseoir l'autorité",
  coreMessage: "la stratège monte sur scène",
  projectId: 7,
  linkedProspectionCampaignId: null,
};

const INPUT = { userId: "user-1", campaignId: 42, raison: "trop centré sur moi" };

function reset() {
  hoisted.resultats = [];
  hoisted.froms = [];
  hoisted.wheres = [];
  hoisted.transactionAppelee = false;
  hoisted.transactionCount = 0;
  hoisted.resultatsArticulations = [];
  hoisted.txFroms = [];
  hoisted.txWheres = [];
  hoisted.txLeftJoins = [];
  hoisted.ordre = [];
  hoisted.updates = [];
  hoisted.deletes = [];
  hoisted.inserts = [];
  hoisted.resultatsOps = [];
  vi.clearAllMocks();
  (embedModule.embedText as any).mockResolvedValue([0.1, 0.2, 0.3]);
}

describe("rejeterCampagne — orchestration transactionnelle", () => {
  beforeEach(() => {
    reset();
  });

  it("cas 1 — une campagne sans contenu ni tâche est supprimée ; aucun détachement, aucune suppression de contenu", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []]; // campagne, contenus (vide), tâches (vide)
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(hoisted.updates).toEqual([]);
    expect(hoisted.deletes.filter((d) => d.table === content)).toEqual([]);
    expect(hoisted.deletes.filter((d) => d.table === tasks)).toEqual([]);
    expect(hoisted.deletes.some((d) => d.table === campaigns)).toBe(true);
    expect(r.contenusDetaches).toBe(0);
    expect(r.contenusSupprimes).toBe(0);
    expect(r.tachesDetachees).toBe(0);
    expect(r.tachesSupprimees).toBe(0);
    // Pas de prospection liée (le 4e tableau de `hoisted.resultats`, consommé par
    // défaut à `[]` quand la file est courte) : aucune cascade de prospection.
    expect(r.prospectionSupprimee).toEqual([]);
  });

  it("cas 2 — un contenu publié (publishedAt) est détaché et non supprimé — clause SET et identifiants vérifiés", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [{ id: 100, publishedAt: new Date("2026-09-01"), postStatus: null, contentStatus: null }],
      [],
    ];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.contenusDetaches).toBe(1);
    expect(r.contenusSupprimes).toBe(0);
    const detach = hoisted.updates.find((u) => u.table === content);
    expect(detach).toBeDefined();
    expect(detach.set).toEqual({ campaignId: null });
    const sql = enSql(detach.where);
    expect(sql.params).toContain(100);
    expect(hoisted.deletes.filter((d) => d.table === content)).toEqual([]);
  });

  it("cas 2b — un contenu publié (postStatus = posted) est détaché et non supprimé", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [{ id: 101, publishedAt: null, postStatus: "posted", contentStatus: null }],
      [],
    ];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.contenusDetaches).toBe(1);
    expect(r.contenusSupprimes).toBe(0);
    const detach = hoisted.updates.find((u) => u.table === content);
    expect(enSql(detach.where).params).toContain(101);
  });

  it("cas 2c — un contenu publié (contentStatus = published) est détaché et non supprimé", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [{ id: 102, publishedAt: null, postStatus: null, contentStatus: "published" }],
      [],
    ];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.contenusDetaches).toBe(1);
    expect(r.contenusSupprimes).toBe(0);
    const detach = hoisted.updates.find((u) => u.table === content);
    expect(enSql(detach.where).params).toContain(102);
  });

  it("cas 3 — un contenu non publié est supprimé", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [{ id: 200, publishedAt: null, postStatus: "draft", contentStatus: "idea" }],
      [],
    ];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.contenusSupprimes).toBe(1);
    expect(r.contenusDetaches).toBe(0);
    const suppression = hoisted.deletes.find((d) => d.table === content);
    expect(suppression).toBeDefined();
    expect(enSql(suppression.where).params).toContain(200);
    expect(hoisted.updates.filter((u) => u.table === content)).toEqual([]);
  });

  it("cas 4 — une tâche faite est détachée ; une tâche non faite est supprimée", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [],
      [
        { id: 300, completed: true },
        { id: 301, completed: false },
      ],
    ];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.tachesDetachees).toBe(1);
    expect(r.tachesSupprimees).toBe(1);
    const detach = hoisted.updates.find((u) => u.table === tasks);
    const suppression = hoisted.deletes.find((d) => d.table === tasks);
    expect(enSql(detach.where).params).toContain(300);
    expect(enSql(suppression.where).params).toContain(301);
  });

  it("cas 5 — avec une raison, une entrée memoryEntries est insérée avec fil 'cap', entryType 'préférence', le bon projectId et la bonne salience", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.preferenceEcrite).toBe(true);
    const insertion = hoisted.inserts.find((i) => i.table === memoryEntries);
    expect(insertion).toBeDefined();
    expect(insertion.values.fil).toBe("cap");
    expect(insertion.values.entryType).toBe("préférence");
    expect(insertion.values.projectId).toBe(CAMPAGNE_LIGNE.projectId);
    expect(insertion.values.salience).toBe(SALIENCE_REJET_ORCH);
    expect(insertion.values.userId).toBe(INPUT.userId);
    expect(typeof insertion.values.content).toBe("string");
  });

  it("cas 6 — sans raison, AUCUNE insertion dans memoryEntries, et preferenceEcrite vaut faux", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne({ ...INPUT, raison: "   " });

    expect(r.preferenceEcrite).toBe(false);
    expect(hoisted.inserts.filter((i) => i.table === memoryEntries)).toEqual([]);
    expect(embedModule.embedText).not.toHaveBeenCalled();
  });

  it("cas 7 — embedText qui rend null : la préférence est quand même insérée, preferenceSansEmbedding vaut vrai, le rejet réussit", async () => {
    (embedModule.embedText as any).mockResolvedValue(null);
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.preferenceEcrite).toBe(true);
    expect(r.preferenceSansEmbedding).toBe(true);
    const insertion = hoisted.inserts.find((i) => i.table === memoryEntries);
    expect(insertion.values.embedding).toBeNull();
  });

  // Important 2 (revue finale du 2026-10-02) : « la limite de l'embedding est
  // énoncée, pas cachée » (Décision 7 du spec) — avant ce point, `preferenceSansEmbedding`
  // n'était renvoyé qu'à l'appelant HTTP, JAMAIS journalisé (aucun `console.*` dans
  // tout `rejeter.ts`, et `embedTexts` dégrade en silence). Une préférence sans
  // vecteur devenait alors invisible à `buildNayaContext` POUR TOUJOURS, et personne
  // ne pouvait savoir laquelle. Sans le `projectId` ET l'id précis de la ligne,
  // l'alerte ne serait pas actionnable — ce test verrouille les DEUX dans le message.
  it("cas 7b — preferenceSansEmbedding vrai : un console.warn nomme le projectId ET l'id de la ligne insérée", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    (embedModule.embedText as any).mockResolvedValue(null);
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];
    hoisted.resultatsOps = [[{ id: 999 }]]; // ce que renvoie `.returning({ id })` sur l'insertion

    await rejeterCampagne(INPUT);

    expect(avertir).toHaveBeenCalledTimes(1);
    const message = avertir.mock.calls[0].join(" ");
    expect(message).toContain(String(CAMPAGNE_LIGNE.projectId));
    expect(message).toContain("999");
    avertir.mockRestore();
  });

  it("cas 7c — preferenceEcrite vrai MAIS embedding présent : AUCUN console.warn n'est émis — l'alerte ne porte que sur l'absence réelle du vecteur", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];
    // embedText (mocké par `reset()`) rend un vecteur non-null par défaut.

    const r = await rejeterCampagne(INPUT);

    expect(r.preferenceSansEmbedding).toBe(false);
    expect(avertir).not.toHaveBeenCalled();
    avertir.mockRestore();
  });

  it("cas 8 — embedText qui lève : même comportement que null (best-effort), le rejet réussit", async () => {
    (embedModule.embedText as any).mockRejectedValue(new Error("panne réseau embedding"));
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.preferenceEcrite).toBe(true);
    expect(r.preferenceSansEmbedding).toBe(true);
    const insertion = hoisted.inserts.find((i) => i.table === memoryEntries);
    expect(insertion.values.embedding).toBeNull();
  });

  it("cas 8b — embedText qui lève SYNCHRONEMENT (pas une promesse rejetée) : même comportement", async () => {
    (embedModule.embedText as any).mockImplementation(() => {
      throw new Error("panne synchrone");
    });
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    const r = await rejeterCampagne(INPUT);

    expect(r.preferenceEcrite).toBe(true);
    expect(r.preferenceSansEmbedding).toBe(true);
  });

  it("cas 9 — tout passe par une seule db.transaction", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    expect(hoisted.transactionAppelee).toBe(true);
    expect(hoisted.transactionCount).toBe(1);
  });

  // Nommé précisément : ce test prouve que l'EXÉCUTION s'arrête après l'échec (rien
  // après l'étape qui a raté n'est même tenté) — pas que Postgres annule physiquement
  // ce qui a déjà été écrit. Cette seconde garantie (rollback réel) vient de
  // `db.transaction` de Drizzle et n'est pas testable sans vraie base, ce qui est
  // précisément ce que ce dépôt interdit en test.
  it("cas 10 — un échec en cours de transaction (suppression du contenu) arrête l'exécution avant la préférence et la suppression de la campagne", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [{ id: 500, publishedAt: null, postStatus: "draft", contentStatus: "idea" }], // un partant
      [],
    ];
    hoisted.resultatsArticulations = [[]];
    // La file d'opérations d'écriture est consommée dans l'ORDRE : ici, la seule
    // opération avant la suppression de la campagne est la suppression du contenu
    // partant (pas de détachement, pas de tâche) — on la fait échouer.
    hoisted.resultatsOps = [new Error("contrainte violée")];

    await expect(rejeterCampagne(INPUT)).rejects.toThrow("contrainte violée");

    // La panne a eu lieu à l'étape "supprimer-contenu" : rien après elle n'a été
    // atteint — ni l'écriture de la préférence, ni la suppression de la campagne.
    expect(hoisted.ordre).toEqual(["articulations-lues", "supprimer-contenu"]);
    expect(hoisted.ordre).not.toContain("preference");
    expect(hoisted.ordre).not.toContain("supprimer-campagne");
  });

  it("cas 11 — les articulations pointant vers la campagne sont relevées avant la suppression et rendues dans le résultat", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[
      { campagneId: 99, campagneNom: "Campagne liée", marque: "Marque Liée" },
    ]];

    const r = await rejeterCampagne(INPUT);

    expect(r.articulationsRompues).toEqual([
      { campagneId: 99, campagneNom: "Campagne liée", marque: "Marque Liée" },
    ]);
    // La lecture précède la suppression de la campagne dans l'ordre observé.
    const idxLecture = hoisted.ordre.indexOf("articulations-lues");
    const idxSuppression = hoisted.ordre.indexOf("supprimer-campagne");
    expect(idxLecture).toBeGreaterThanOrEqual(0);
    expect(idxLecture).toBeLessThan(idxSuppression);
  });

  it("cas 11b — la lecture des articulations rompues porte aussi sur userId, par défense en profondeur (pas seulement articuleAvecCampaignId)", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    expect(hoisted.txWheres).toHaveLength(1);
    const clause = enSql(hoisted.txWheres[0]);
    expect(clause.sql).toContain('"campaigns"."user_id"');
    expect(clause.sql).toContain('"campaigns"."articule_avec_campaign_id"');
    expect(clause.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId]));
  });

  it("cas 12 — l'ordre des opérations est détachement → suppression → préférence → campagne", async () => {
    hoisted.resultats = [
      [CAMPAGNE_LIGNE],
      [
        { id: 600, publishedAt: new Date("2026-09-01"), postStatus: null, contentStatus: null }, // gardé
        { id: 601, publishedAt: null, postStatus: "draft", contentStatus: "idea" },               // partant
      ],
      [
        { id: 700, completed: true },  // gardée
        { id: 701, completed: false }, // partante
      ],
    ];
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    expect(hoisted.ordre).toEqual([
      "articulations-lues",
      "detacher-contenu",
      "detacher-tache",
      "supprimer-contenu",
      "supprimer-tache",
      "preference",
      "supprimer-campagne",
    ]);
  });

  it("cas 13 — une campagne qui n'appartient pas à l'utilisatrice n'est jamais touchée : la clause porte sur userId ET id", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    // La clause de la lecture initiale (hors transaction) porte sur les deux.
    const clauseLecture = enSql(hoisted.wheres[0]);
    expect(clauseLecture.sql).toContain('"campaigns"."user_id"');
    expect(clauseLecture.sql).toContain('"campaigns"."id"');
    expect(clauseLecture.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId]));

    // La clause de la suppression finale de la campagne porte aussi sur les deux.
    const suppressionCampagne = hoisted.deletes.find((d) => d.table === campaigns);
    const clauseSuppression = enSql(suppressionCampagne.where);
    expect(clauseSuppression.sql).toContain('"campaigns"."user_id"');
    expect(clauseSuppression.sql).toContain('"campaigns"."id"');
    expect(clauseSuppression.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId]));
  });

  // Verrouille l'intention, pas la chance : sans ce test, retirer
  // `eq(content.userId, userId)` (ou son équivalent sur `tasks`) du code laissait les
  // 34 tests verts — la clause était supposée, jamais affirmée. Chaque lecture doit
  // porter sur SON PROPRE userId ET sur campaignId, pas seulement sur campaignId
  // (qui suffirait si on faisait confiance à l'étanchéité déjà garantie par la
  // lecture de la campagne elle-même — défense en profondeur quand même).
  it("cas 13b — les lectures de content et de tasks portent chacune sur userId ET campaignId", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], []];
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    // hoisted.wheres : [0] = campagne, [1] = content, [2] = tasks, [3] = prospection
    // liée (voir cas 14 pour cette dernière).
    expect(hoisted.wheres).toHaveLength(4);

    const clauseContenus = enSql(hoisted.wheres[1]);
    expect(clauseContenus.sql).toContain('"content"."user_id"');
    expect(clauseContenus.sql).toContain('"content"."campaign_id"');
    expect(clauseContenus.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId]));

    const clauseTaches = enSql(hoisted.wheres[2]);
    expect(clauseTaches.sql).toContain('"tasks"."user_id"');
    expect(clauseTaches.sql).toContain('"tasks"."campaign_id"');
    expect(clauseTaches.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId]));
  });

  // Important 1 (revue finale du 2026-10-02) : la cascade de prospection perdue est
  // revenue — l'ancien bouton Supprimer cascadait vers la campagne de prospection
  // liée, `rejeterCampagne` doit faire pareil. Le relevé du lien se lit dans LES DEUX
  // SENS : `campaigns.linkedProspectionCampaignId` (direct) ET
  // `prospectionCampaigns.linkedCampaignId` (inverse) — même motif que
  // `storage.deleteCampaign`.
  it("cas 14 — la lecture de la prospection liée porte sur le lien INVERSE seul quand la campagne n'a pas de lien direct, et sur userId", async () => {
    hoisted.resultats = [[CAMPAGNE_LIGNE], [], [], []]; // pas de linkedProspectionCampaignId
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    expect(hoisted.wheres).toHaveLength(4);
    const clauseProspection = enSql(hoisted.wheres[3]);
    expect(clauseProspection.sql).toContain('"prospection_campaigns"."user_id"');
    expect(clauseProspection.sql).toContain('"prospection_campaigns"."linked_campaign_id"');
    // Pas de lien direct sur la campagne ⇒ pas de condition sur l'id de la prospection.
    expect(clauseProspection.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId]));
  });

  it("cas 14b — la lecture de la prospection liée porte AUSSI sur le lien DIRECT quand la campagne en a un", async () => {
    const campagneAvecLienDirect = { ...CAMPAGNE_LIGNE, linkedProspectionCampaignId: 55 };
    hoisted.resultats = [[campagneAvecLienDirect], [], [], []];
    hoisted.resultatsArticulations = [[]];

    await rejeterCampagne(INPUT);

    const clauseProspection = enSql(hoisted.wheres[3]);
    expect(clauseProspection.sql).toContain('"prospection_campaigns"."user_id"');
    expect(clauseProspection.sql).toContain('"prospection_campaigns"."linked_campaign_id"');
    // Le lien direct (par id) est AUSSI interrogé — « les deux sens » n'est pas
    // seulement un énoncé, c'est une condition SQL vérifiable.
    expect(clauseProspection.sql).toContain('"prospection_campaigns"."id"');
    expect(clauseProspection.params).toEqual(expect.arrayContaining([INPUT.userId, INPUT.campaignId, 55]));
  });

  // Une classe dédiée, pas une `Error` nue : motif de `ReponseIllisible`
  // (content-import/import.ts), reconnue par `instanceof` côté route pour un code
  // HTTP précis, sans jamais dépendre du message (qui est en français et peut changer).
  it("une campagne introuvable (mauvais id ou mauvais userId) lève CampagneIntrouvable, sans toucher à quoi que ce soit", async () => {
    hoisted.resultats = [[]]; // la lecture de la campagne ne rend rien

    let erreur: unknown;
    try {
      await rejeterCampagne(INPUT);
    } catch (e) {
      erreur = e;
    }

    expect(erreur).toBeInstanceOf(CampagneIntrouvable);
    expect((erreur as Error).message).toMatch(/introuvable/);
    expect(hoisted.transactionAppelee).toBe(false);
    expect(embedModule.embedText).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Important 1 (revue finale du 2026-10-02) — la cascade de prospection, perdue par le
// passage à `tx.delete(campaigns)` direct, revient : rejeter une campagne doit
// cascader vers sa prospection liée exactement comme le faisait l'ancien bouton
// Supprimer (`storage.deleteCampaign` → `storage.deleteProspectionCampaign`).
//
// `../../storage` n'est PAS mocké ICI (contrairement à `../../db`) : c'est le VRAI
// `storage.deleteProspectionCampaign` qui s'exécute, contre le même faux `tx` que le
// reste de ce fichier. C'est délibéré, pas un oubli — c'est ce qui permet au test de
// vérifier la propriété centrale du point 1 directement sur l'implémentation réelle :
// appelée avec un exécuteur (`tx`), elle ne doit PAS ouvrir sa propre transaction
// (sans quoi `hoisted.transactionCount` vaudrait 2, pas 1).
describe("rejeterCampagne — cascade vers la prospection liée", () => {
  beforeEach(() => {
    reset();
  });

  it("une prospection liée (lien direct) est cascadée DANS LA MÊME transaction — prospects archivés (jamais supprimés), séquences supprimées, lien délié des deux côtés, la prospection elle-même supprimée, tout AVANT la suppression de la campagne marketing", async () => {
    const campagneAvecLienDirect = { ...CAMPAGNE_LIGNE, linkedProspectionCampaignId: 55 };
    hoisted.resultats = [
      [campagneAvecLienDirect], // campagne
      [], // contenus
      [], // tâches
      [{ id: 55, name: "Prospection vignerons bio" }], // prospection liée (hors transaction)
    ];
    hoisted.resultatsArticulations = [
      [], // articulations-lues
      [{ id: 55 }], // vérification de propriété, dans deleteProspectionCampaign (exécuteur = tx)
      [], // stepIds vide → pas de purge de leadStepMessages
    ];

    // Raison vide : pas de préférence à écrire, pour ne pas allonger inutilement la
    // file d'opérations que ce test doit suivre.
    const r = await rejeterCampagne({ ...INPUT, raison: "" });

    // LE POINT CENTRAL du point 1 : une seule transaction, malgré la cascade de
    // prospection. Si `deleteProspectionCampaign` avait ouvert sa propre
    // `db.transaction` au lieu d'utiliser `tx`, ce compteur vaudrait 2.
    expect(hoisted.transactionCount).toBe(1);

    expect(r.prospectionSupprimee).toEqual([{ id: 55, name: "Prospection vignerons bio" }]);

    // Prospects ARCHIVÉS, jamais supprimés — le mot compte (brief, point 1).
    const archivage = hoisted.updates.find((u) => u.table === leads);
    expect(archivage).toBeDefined();
    expect(archivage!.set.archivedAt).toBeInstanceOf(Date);
    expect(archivage!.set.prospectionCampaignId).toBeNull();
    expect(hoisted.deletes.some((d) => d.table === leads)).toBe(false);

    // Séquences supprimées.
    expect(hoisted.deletes.some((d) => d.table === TABLE_LEAD_SEQ_STATE)).toBe(true);
    expect(hoisted.deletes.some((d) => d.table === TABLE_OUTREACH_SENDS)).toBe(true);
    expect(hoisted.deletes.some((d) => d.table === TABLE_SEQ_STEPS)).toBe(true);

    // Lien délié des deux côtés.
    const delierUsage = hoisted.updates.find((u) => u.table === TABLE_PROSPECTION_USAGE);
    expect(delierUsage?.set).toEqual({ campaignId: null });
    const delierLien = hoisted.updates.find((u) => u.table === campaigns && u.set && "linkedProspectionCampaignId" in u.set);
    expect(delierLien?.set).toEqual({ linkedProspectionCampaignId: null });

    // La campagne de prospection elle-même est supprimée.
    expect(hoisted.deletes.some((d) => d.table === prospectionCampaigns)).toBe(true);

    // Tout ceci précède la suppression FINALE de la campagne marketing.
    const idxDelier = hoisted.ordre.indexOf("delier-prospection-sur-campagne");
    const idxSuppressionProspection = hoisted.ordre.indexOf("supprimer-prospection-campaign");
    const idxSuppressionCampagne = hoisted.ordre.lastIndexOf("supprimer-campagne");
    expect(idxDelier).toBeGreaterThanOrEqual(0);
    expect(idxSuppressionProspection).toBeGreaterThan(idxDelier);
    expect(idxSuppressionCampagne).toBeGreaterThan(idxSuppressionProspection);
  });

  it("un échec PENDANT la cascade de prospection arrête tout — ni le reste de la cascade, ni la suppression de la campagne marketing ne sont atteints (atomicité du rejet)", async () => {
    const campagneAvecLienDirect = { ...CAMPAGNE_LIGNE, linkedProspectionCampaignId: 55 };
    hoisted.resultats = [
      [campagneAvecLienDirect], [], [],
      [{ id: 55, name: "Prospection vignerons bio" }],
    ];
    hoisted.resultatsArticulations = [
      [], // articulations-lues
      new Error("panne pendant la vérification de propriété de la prospection"), // la cascade échoue ICI
    ];

    await expect(rejeterCampagne({ ...INPUT, raison: "" })).rejects.toThrow(
      /panne pendant la vérification/,
    );

    // Rien après l'échec n'a été atteint — ni la suite de la cascade de prospection,
    // ni la suppression de la campagne marketing elle-même.
    expect(hoisted.updates.some((u) => u.table === leads)).toBe(false);
    expect(hoisted.deletes.some((d) => d.table === prospectionCampaigns)).toBe(false);
    expect(hoisted.deletes.some((d) => d.table === campaigns)).toBe(false);
  });
});
