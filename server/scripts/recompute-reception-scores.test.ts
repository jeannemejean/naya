import { describe, it, expect, vi, beforeEach } from "vitest";

// L'embedding ne doit jamais partir en réseau depuis un test.
vi.mock("../services/memory/embed", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { recomputeReceptionScores, type RecomputeRepo, type ReceptionRow, type NewMemoryEntry } from "./recompute-reception-scores";
import { receivedVsIntentScore } from "../services/reception/score";

type FakeMemoryRow = {
  id: number; userId: string; fil: string; entryType: string; content: string;
  supersededAt: Date | null;
  /** Optionnel dans les fixtures ; le faux store le normalise à `null` (colonne nullable). */
  createdAt?: Date | null;
};

/**
 * Faux store EN MÉMOIRE — pas des mocks vitest sur des appels : le test d'idempotence
 * doit compter des LIGNES réellement changées dans un store, pas des invocations de mock
 * (une fonction peut être appelée deux fois et n'avoir rien changé la seconde fois).
 */
function fakeRepo(initial: {
  reception: ReceptionRow[];
  creditSums?: Record<number, number | null>;
  memory?: FakeMemoryRow[];
}): RecomputeRepo & {
  receptionRows: ReceptionRow[];
  memoryRows: FakeMemoryRow[];
  insertedMemory: NewMemoryEntry[];
  /** Fait échouer le PROCHAIN `replaceMemoryEntry` — simule une panne mi-course pour
   * vérifier l'atomicité (rien n'est appliqué si l'appel échoue). */
  failNextReplace: boolean;
} {
  const receptionRows = initial.reception.map((r) => ({ ...r }));
  const creditSums = initial.creditSums ?? {};
  const memoryRows = (initial.memory ?? []).map((m) => ({ createdAt: null, ...m }));
  const insertedMemory: NewMemoryEntry[] = [];
  let nextMemoryId = memoryRows.reduce((max, m) => Math.max(max, m.id), 0) + 1;

  const repo = {
    receptionRows,
    memoryRows,
    insertedMemory,
    failNextReplace: false,
    async listReceptionRows() {
      // Copie défensive : simule un aller-retour DB, jamais la même référence.
      return receptionRows.map((r) => ({ ...r }));
    },
    async getConversionCreditSum(contentId: number) {
      // Fidèle au contrat réel de `storage.getConversionCreditSumForContent` (C1) : un
      // contenu SANS aucune ligne d'attribution renvoie `null` (non mesuré), jamais `0`.
      return creditSums[contentId] ?? null;
    },
    async updateReceptionScore(id: number, patch: any) {
      const row = receptionRows.find((r) => r.id === id);
      if (!row) throw new Error(`ligne ${id} introuvable`);
      row.receivedVsIntentScore = patch.receivedVsIntentScore;
      row.confidence = patch.confidence;
      row.rationale = patch.rationale;
    },
    async findActiveMemoryEntry({ userId, fil, entryType, contentPrefix }: any) {
      const found = memoryRows.find(
        (m) => m.userId === userId && m.fil === fil && m.entryType === entryType &&
          m.supersededAt === null && m.content.startsWith(contentPrefix),
      );
      // La date d'origine fait partie du contrat : la remplaçante doit la reprendre (I1).
      return found ? { id: found.id, createdAt: found.createdAt ?? null } : null;
    },
    // Simule l'atomicité d'un `db.transaction()` : soit les DEUX effets (supersède +
    // insère) sont appliqués, soit AUCUN ne l'est — jamais l'ancienne entrée périmée sans
    // remplaçante. C'est le CONTRAT que la vraie implémentation DB (dbRecomputeRepo) doit
    // aussi respecter, elle via `db.transaction`.
    async replaceMemoryEntry(oldEntryId: number, newEntry: NewMemoryEntry) {
      if (repo.failNextReplace) {
        repo.failNextReplace = false;
        throw new Error("panne DB simulée (replaceMemoryEntry)");
      }
      const old = memoryRows.find((m) => m.id === oldEntryId);
      if (old) old.supersededAt = new Date();
      insertedMemory.push(newEntry);
      memoryRows.push({
        id: nextMemoryId++,
        userId: newEntry.userId,
        fil: newEntry.fil,
        entryType: newEntry.entryType,
        content: newEntry.content,
        supersededAt: null,
        // La vraie implémentation POSE createdAt explicitement (la colonne a un
        // `defaultNow()` qui, sinon, redaterait le souvenir à aujourd'hui).
        createdAt: newEntry.createdAt,
      });
    },
  };
  return repo;
}

function row(overrides: Partial<ReceptionRow> = {}): ReceptionRow {
  return {
    id: 1,
    contentId: 1,
    projectId: 7,
    platform: "instagram",
    saves: 20,
    shares: 5,
    comments: 3,
    reach: 1000,
    sentimentScore: null,
    receivedVsIntentScore: null,
    confidence: 0,
    rationale: "Portée inconnue.",
    contentTitle: "Post de lancement",
    contentIntent: "conversion",
    contentUserId: "u1",
    ...overrides,
  };
}

/** Le préfixe STABLE (indépendant de la rationale) de la phrase mémoire produite par
 * `formatReceptionMemoryPhrase` pour un score non nul — dupliqué ici volontairement pour
 * construire des fixtures de test, jamais utilisé par le code de production lui-même. */
function stablePrefix(score: number, intent = "conversion", title = "Post de lancement", platform = "instagram"): string {
  return (
    `Réception mesurée du contenu « ${title} » (${platform}) : ` +
    `score ${(score * 100).toFixed(0)}/100 ` +
    `contre une intention ${intent}. `
  );
}

describe("recomputeReceptionScores", () => {
  it("un contenu crédité voit son score bouger par rapport au même contenu sans crédit", async () => {
    // Deux contenus IDENTIQUES en signaux, un seul crédité. Si conversionsInWindow n'était
    // pas réellement câblé sur la somme des crédits, les deux scores resteraient égaux et
    // ce test ne pourrait jamais échouer.
    const repo = fakeRepo({
      reception: [
        row({ id: 1, contentId: 1 }),
        row({ id: 2, contentId: 2 }),
      ],
      creditSums: { 1: 0.6, 2: 0 },
    });

    await recomputeReceptionScores(repo);

    const credite = repo.receptionRows.find((r) => r.id === 1)!;
    const nonCredite = repo.receptionRows.find((r) => r.id === 2)!;

    expect(credite.receivedVsIntentScore).not.toBe(nonCredite.receivedVsIntentScore);

    // Et chacun correspond EXACTEMENT au calcul pur avec la bonne somme.
    const attendu1 = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0.6,
    });
    const attendu2 = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0,
    });
    expect(credite.receivedVsIntentScore).toBe(attendu1.score);
    expect(nonCredite.receivedVsIntentScore).toBe(attendu2.score);
  });

  /**
   * C1 (revue finale) — un contenu SANS aucune ligne d'attribution est NON MESURÉ, pas
   * « mesuré à zéro ». Sans ce verrou, tout contenu d'intention conversion d'une marque
   * n'ayant déclaré aucune conversion se voyait plafonné à 0,30/1 avec une confiance ~0,9,
   * et ce script gravait ce verdict en mémoire à la salience la plus haute du fil
   * "reception". On vérifie les DEUX faces : le verdict est bien celui du non-mesuré, et il
   * n'est PAS celui du zéro mesuré (un simple `not.toBeNull()` ne verrouillerait rien).
   */
  it("un contenu sans aucune ligne d'attribution reçoit le verdict NON MESURÉ, jamais l'échec mesuré à zéro", async () => {
    const repo = fakeRepo({
      reception: [row({ id: 1, contentId: 1, contentIntent: "conversion" })],
      creditSums: {}, // aucune ligne d'attribution pour ce contenu
    });

    await recomputeReceptionScores(repo);

    const ligne = repo.receptionRows.find((r) => r.id === 1)!;
    const nonMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    const zeroMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0,
    });

    expect(ligne.receivedVsIntentScore).toBe(nonMesure.score);
    expect(ligne.confidence).toBe(nonMesure.confidence);
    expect(ligne.receivedVsIntentScore).not.toBe(zeroMesure.score);
    expect(ligne.confidence).not.toBe(zeroMesure.confidence);
  });

  it("est idempotent : un deuxième passage ne met à jour aucune ligne réelle, ni la mémoire", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    expect(ancienneMesure.score).not.toBeNull();
    const phraseAncienne = stablePrefix(ancienneMesure.score as number) + ancienneMesure.rationale;

    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: ancienneMesure.rationale,
      })],
      creditSums: { 1: 0.6 },
      memory: [{ id: 100, userId: "u1", fil: "reception", entryType: "signal_reception", content: phraseAncienne, supersededAt: null }],
    });

    const premierPassage = await recomputeReceptionScores(repo);
    expect(premierPassage.updated).toBeGreaterThan(0);
    expect(premierPassage.memorySuperseded).toBe(1);

    const etatReceptionApresPremierPassage = repo.receptionRows.map((r) => ({ ...r }));
    const etatMemoireApresPremierPassage = repo.memoryRows.map((m) => ({ ...m }));

    const deuxiemePassage = await recomputeReceptionScores(repo);

    expect(deuxiemePassage.updated).toBe(0);
    expect(deuxiemePassage.memorySuperseded).toBe(0);
    // Les lignes réelles du store n'ont PAS bougé — pas seulement « la fonction a été
    // appelée moins souvent ».
    expect(repo.receptionRows).toEqual(etatReceptionApresPremierPassage);
    // Ni la mémoire : aucune entrée périmée ou insérée de plus au deuxième passage.
    expect(repo.memoryRows).toEqual(etatMemoireApresPremierPassage);
    expect(repo.insertedMemory).toHaveLength(1);
  });

  it("supersède l'entrée mémoire et en écrit une nouvelle sur un changement matériel (écart > 0,05)", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    // `conversionsInWindow: null` exclut le signal conversion du calcul mais saves/shares/
    // comments restent présents pour l'intention "conversion" : le score n'est PAS null ici
    // (seuls un contenu sans intention, sans portée, ou sans aucun signal mesuré le sont).
    expect(ancienneMesure.score).not.toBeNull();
    const phraseAncienne = stablePrefix(ancienneMesure.score as number) + ancienneMesure.rationale;

    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: ancienneMesure.rationale,
      })],
      creditSums: { 1: 0.6 },
      memory: [{ id: 100, userId: "u1", fil: "reception", entryType: "signal_reception", content: phraseAncienne, supersededAt: null }],
    });

    await recomputeReceptionScores(repo);

    const ancienne = repo.memoryRows.find((m) => m.id === 100)!;
    expect(ancienne.supersededAt).not.toBeNull();
    expect(repo.insertedMemory).toHaveLength(1);
    const nouvelle = repo.insertedMemory[0] as { content: string };
    expect(nouvelle.content).not.toBe(phraseAncienne);
    expect(nouvelle.content).toContain("Post de lancement");
  });

  /**
   * I1 (revue finale) — le remplacement doit REPRENDRE la date d'origine du souvenir
   * périmé. `memory_entries.created_at` a un `defaultNow()` : ne pas la poser
   * explicitement redate la remplaçante à aujourd'hui. Or la demi-vie du fil "reception"
   * est de 10 jours (la plus courte des trois, voir services/memory/retrieve.ts) : une
   * mesure de trois mois a une fraîcheur de ~0,002, qui deviendrait 1,0 après un passage.
   * Comme le script traite TOUT l'historique en un run, une seule exécution aplatirait le
   * signal de fraîcheur de tout le fil et ferait passer les vieilles mesures devant les
   * récentes dans le top-K de chaque appel IA. Un verdict corrigé sur un fait ancien reste
   * un fait ancien.
   */
  it("préserve la date d'origine du souvenir remplacé — jamais un created_at neuf", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    const phraseAncienne = stablePrefix(ancienneMesure.score as number) + ancienneMesure.rationale;
    const dateOrigine = new Date("2026-06-01T09:30:00.000Z"); // ~3 mois avant le run

    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: ancienneMesure.rationale,
      })],
      creditSums: { 1: 0.6 },
      memory: [{
        id: 100, userId: "u1", fil: "reception", entryType: "signal_reception",
        content: phraseAncienne, supersededAt: null, createdAt: dateOrigine,
      }],
    });

    await recomputeReceptionScores(repo);

    expect(repo.insertedMemory).toHaveLength(1);
    expect(repo.insertedMemory[0].createdAt).toEqual(dateOrigine);
    // Et la ligne réellement posée dans le store porte bien cette date, pas « maintenant ».
    const remplacante = repo.memoryRows.find((m) => m.id !== 100)!;
    expect(remplacante.createdAt).toEqual(dateOrigine);
  });

  it("ne touche pas la mémoire sur un changement non matériel (écart <= 0,05)", async () => {
    // L'ancien score est calé à 0,03 du score réellement recalculé : matérialise une DÉRIVE
    // (ex. arrondi historique) sans franchir le seuil de matérialité (> 0,05).
    const nouveau = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0,
    });
    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: (nouveau.score as number) - 0.03,
        confidence: nouveau.confidence,
        rationale: nouveau.rationale,
      })],
      creditSums: { 1: 0 },
    });

    const result = await recomputeReceptionScores(repo);

    expect(result.updated).toBeGreaterThan(0); // le score, lui, est bien rafraîchi...
    expect(repo.insertedMemory).toHaveLength(0); // ...mais aucune écriture mémoire.
  });

  it("scanne toutes les lignes fournies par le repo", async () => {
    const repo = fakeRepo({
      reception: [row({ id: 1, contentId: 1 }), row({ id: 2, contentId: 2 }), row({ id: 3, contentId: 3 })],
    });

    const result = await recomputeReceptionScores(repo);

    expect(result.scanned).toBe(3);
  });

  /**
   * Une ligne en échec ne doit jamais arrêter le recalcul des autres — sans quoi une
   * exception sur la ligne N d'un run de plusieurs centaines laisserait toutes les
   * suivantes non recalculées, invisible dans le résultat.
   */
  it("une ligne en échec est reportée dans errors sans bloquer les autres lignes", async () => {
    const repo = fakeRepo({
      reception: [row({ id: 1, contentId: 1 }), row({ id: 2, contentId: 2 })],
      creditSums: { 1: 0.6, 2: 0.6 },
    });
    const original = repo.updateReceptionScore.bind(repo);
    repo.updateReceptionScore = async (id, patch) => {
      if (id === 1) throw new Error("panne DB simulée");
      return original(id, patch);
    };

    const result = await recomputeReceptionScores(repo);

    expect(result.errors).toEqual([
      expect.objectContaining({ receptionId: 1, contentId: 1 }),
    ]);
    expect(result.updated).toBe(1); // la ligne 2 a quand même été traitée.
    expect(repo.receptionRows.find((r) => r.id === 2)!.receivedVsIntentScore).not.toBeNull();
  });

  /**
   * FINDING 1 (review fix round 1) — atomicité supersède+insert. Sans transaction, un
   * échec entre les deux périmerait l'ancienne entrée SANS remplaçante : le fil
   * "reception" deviendrait vide pour ce contenu, PERMANENT (le score, lui, ne serait
   * corrigé que par un appel séparé plus bas, donc la ligne ne serait plus jamais
   * "changée" au prochain passage). Ce test vérifie le CONTRAT côté appelant : un échec de
   * `replaceMemoryEntry` laisse l'ancienne entrée ACTIVE (rejouable) et ne corrige PAS non
   * plus le score — la ligne reste "changée" et sera retentée en entier au prochain run.
   */
  it("un échec de replaceMemoryEntry laisse l'ancienne entrée mémoire intacte, jamais orpheline", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    const phraseAncienne = stablePrefix(ancienneMesure.score as number) + ancienneMesure.rationale;

    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: ancienneMesure.rationale,
      })],
      creditSums: { 1: 0.6 },
      memory: [{ id: 100, userId: "u1", fil: "reception", entryType: "signal_reception", content: phraseAncienne, supersededAt: null }],
    });
    repo.failNextReplace = true;

    const result = await recomputeReceptionScores(repo);

    expect(result.errors).toHaveLength(1);
    const ancienne = repo.memoryRows.find((m) => m.id === 100)!;
    expect(ancienne.supersededAt).toBeNull(); // TOUJOURS active — pas orpheline.
    expect(repo.insertedMemory).toHaveLength(0);
    // Le score n'a PAS non plus été corrigé : la ligne reste "changée" pour un rejeu complet.
    expect(repo.receptionRows.find((r) => r.id === 1)!.receivedVsIntentScore).toBe(ancienneMesure.score);
  });

  /**
   * FINDING 2 (review fix round 1) — une `rationale` nulle en base (colonne nullable,
   * chemins d'écriture hors `ingest.ts` anticipés par le schéma) ne doit plus empêcher de
   * retrouver l'entrée mémoire : l'appariement se fait sur le PRÉFIXE stable, jamais sur
   * la rationale. Contre l'ANCIEN code (égalité stricte avec `r.rationale ?? ""`), ce test
   * échoue : la phrase reconstruite avec une rationale vide ne correspond jamais à la
   * phrase réellement stockée (qui porte la VRAIE rationale d'origine).
   */
  it("une rationale null en base n'empêche pas de retrouver l'entrée mémoire (appariement par préfixe)", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    // La phrase RÉELLEMENT stockée porte une rationale non vide (écrite par ingest.ts à
    // l'époque) ; seule la colonne `content_reception.rationale` est devenue NULL en base.
    const phraseReelle = stablePrefix(ancienneMesure.score as number) + "Une rationale d'origine quelconque, perdue depuis.";

    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: null, // <-- le cas du Finding 2
      })],
      creditSums: { 1: 0.6 },
      memory: [{ id: 100, userId: "u1", fil: "reception", entryType: "signal_reception", content: phraseReelle, supersededAt: null }],
    });

    await recomputeReceptionScores(repo);

    const ancienne = repo.memoryRows.find((m) => m.id === 100)!;
    expect(ancienne.supersededAt).not.toBeNull(); // retrouvée ET périmée malgré rationale: null.
    expect(repo.insertedMemory).toHaveLength(1);
  });

  /**
   * FINDING 2, second volet — quand rien n'est retrouvé malgré un changement matériel,
   * l'opérateur doit pouvoir le distinguer du cas normal (pas de changement du tout).
   * Un `console.warn` distinguable, nommant le contenu, est le seul signal disponible.
   */
  it("un changement matériel sans entrée mémoire retrouvée émet un avertissement nommant le contenu", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    const repo = fakeRepo({
      reception: [row({
        id: 7, contentId: 42,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: ancienneMesure.rationale,
      })],
      creditSums: { 42: 0.6 },
      // Aucune entrée mémoire dans le store : rien à retrouver.
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await recomputeReceptionScores(repo);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain("42"); // contentId nommé, pour qu'un opérateur puisse agir.
    expect(message).toContain("AUCUNE"); // distinguable du cas "rien de changé" (silencieux).
    warnSpy.mockRestore();
  });
});
