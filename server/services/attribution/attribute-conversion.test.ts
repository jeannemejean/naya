import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke le storage (accès DB) : seule la logique du moteur (attribute-conversion.ts) doit
// être exercée par ces tests, jamais une vraie base. La décision pure (quel contenu, quel
// poids) est déjà couverte par attribute.test.ts — on ne la reteste pas ici.
vi.mock("../../storage", () => ({
  storage: {
    getBrandConversion: vi.fn(),
    getContentCandidatesForProject: vi.fn(),
    replaceConversionAttributions: vi.fn(),
    getProject: vi.fn(),
  },
}));

import { storage } from "../../storage";
import { attributeConversion } from "./attribute-conversion";

const JOUR = 86_400_000;
const CONVERTED_AT = new Date("2026-08-20T00:00:00.000Z");

function conversionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 7,
    convertedAt: CONVERTED_AT,
    conversionType: "vente",
    value: 100,
    attributionWindowDays: 30,
    createdAt: new Date(),
    ...overrides,
  };
}

function candidate(id: number, joursAvant: number, projectId = 7) {
  return { id, projectId, publishedAt: new Date(CONVERTED_AT.getTime() - joursAvant * JOUR) };
}

/**
 * Faux `conversion_attributions` fidèle à la contrainte unique réelle
 * `(conversion_id, content_id)` : REMPLACER = supprimer les lignes de cette conversion puis
 * insérer les nouvelles. Sert au test d'idempotence : on compte des LIGNES réelles dans la
 * table simulée, pas des appels de mock — un mock appelé N fois ne prouve rien sur ce qui a
 * fini par rester en base.
 */
function fakeAttributionsTable() {
  let nextId = 1;
  const rows = new Map<number, { id: number; conversionId: number; contentId: number; creditWeight: number }>();
  const replace = vi.fn(
    async (conversionId: number, lines: Array<{ contentId: number; creditWeight: number }>) => {
      for (const [id, row] of rows) {
        if (row.conversionId === conversionId) rows.delete(id);
      }
      const written = lines.map((l) => {
        const row = { id: nextId++, conversionId, contentId: l.contentId, creditWeight: l.creditWeight };
        rows.set(row.id, row);
        return row;
      });
      return written;
    },
  );
  return { rows, replace };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attributeConversion — la fenêtre est celle FIGÉE sur la conversion", () => {
  it("utilise attributionWindowDays de la conversion, jamais celle (différente) du projet", async () => {
    // Le projet est réglé à 60 jours aujourd'hui. La conversion, elle, a été calculée avec une
    // fenêtre de 7 jours, figée sur sa ligne au moment des faits. Un contenu publié 10 jours
    // avant la conversion doit être EXCLU si le moteur lit bien la fenêtre de la conversion
    // (7j) — et serait à tort INCLUS s'il relisait la fenêtre courante du projet (60j).
    (storage.getBrandConversion as any).mockResolvedValue(conversionRow({ attributionWindowDays: 7 }));
    (storage.getProject as any).mockResolvedValue({ id: 7, attributionWindowDays: 60 });
    (storage.getContentCandidatesForProject as any).mockResolvedValue([
      candidate(1, 10), // 10 jours avant : hors fenêtre conversion (7j), dans fenêtre projet (60j)
      candidate(2, 2),  // 2 jours avant : dans les deux fenêtres
    ]);
    const table = fakeAttributionsTable();
    (storage.replaceConversionAttributions as any).mockImplementation(table.replace);

    const lignes = await attributeConversion(1);

    // Preuve comportementale : si la fenêtre du projet (60j) avait été utilisée, les deux
    // contenus seraient dans la fenêtre et le crédit serait 50/50. La fenêtre de la
    // conversion (7j) exclut le contenu 1 : 100 % doit revenir au contenu 2 seul.
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ contentId: 2, creditWeight: 1 });

    // Preuve directe : le moteur n'a même pas besoin de connaître le projet pour attribuer.
    expect(storage.getProject).not.toHaveBeenCalled();
  });
});

describe("attributeConversion — idempotence du rejeu", () => {
  it("rejouer sur la même conversion laisse le même nombre de lignes, avec les mêmes poids", async () => {
    (storage.getBrandConversion as any).mockResolvedValue(conversionRow({ attributionWindowDays: 30 }));
    (storage.getContentCandidatesForProject as any).mockResolvedValue([
      candidate(1, 28),
      candidate(2, 14),
      candidate(3, 2),
    ]);
    const table = fakeAttributionsTable();
    (storage.replaceConversionAttributions as any).mockImplementation(table.replace);

    const premier = await attributeConversion(1);
    const second = await attributeConversion(1);
    const troisieme = await attributeConversion(1);

    // Trois rejeux, mais la table réelle ne contient jamais qu'une génération de lignes.
    expect(table.rows.size).toBe(3);
    expect(troisieme).toHaveLength(3);
    expect(premier.map((l) => ({ contentId: l.contentId, creditWeight: l.creditWeight })))
      .toEqual(troisieme.map((l) => ({ contentId: l.contentId, creditWeight: l.creditWeight })));
    for (const l of troisieme) {
      expect(Math.abs(l.creditWeight - 1 / 3)).toBeLessThan(1e-9);
    }
  });

  it("appelle replaceConversionAttributions une fois par rejeu, jamais un ajout manuel", async () => {
    (storage.getBrandConversion as any).mockResolvedValue(conversionRow({ attributionWindowDays: 30 }));
    (storage.getContentCandidatesForProject as any).mockResolvedValue([candidate(1, 5)]);
    const table = fakeAttributionsTable();
    (storage.replaceConversionAttributions as any).mockImplementation(table.replace);

    await attributeConversion(1);
    await attributeConversion(1);
    await attributeConversion(1);

    // L'engine ne fait jamais lui-même un delete+insert : il délègue au remplacement
    // transactionnel du storage, une fois par rejeu.
    expect(table.replace).toHaveBeenCalledTimes(3);
    expect(table.rows.size).toBe(1);
  });
});

describe("attributeConversion — fenêtre vide", () => {
  it("écrit zéro ligne et ne lève aucune exception quand aucun contenu candidat n'est dans la fenêtre", async () => {
    (storage.getBrandConversion as any).mockResolvedValue(conversionRow({ attributionWindowDays: 30 }));
    (storage.getContentCandidatesForProject as any).mockResolvedValue([
      candidate(1, 90), // bien avant la fenêtre de 30 jours
    ]);
    const table = fakeAttributionsTable();
    (storage.replaceConversionAttributions as any).mockImplementation(table.replace);

    await expect(attributeConversion(1)).resolves.toEqual([]);
    expect(table.rows.size).toBe(0);
  });

  it("écrit zéro ligne quand le projet n'a encore aucun contenu candidat", async () => {
    (storage.getBrandConversion as any).mockResolvedValue(conversionRow());
    (storage.getContentCandidatesForProject as any).mockResolvedValue([]);
    const table = fakeAttributionsTable();
    (storage.replaceConversionAttributions as any).mockImplementation(table.replace);

    await expect(attributeConversion(1)).resolves.toEqual([]);
    expect(table.rows.size).toBe(0);
  });
});

describe("attributeConversion — garde-fous", () => {
  it("lève une erreur explicite si la conversion est introuvable", async () => {
    (storage.getBrandConversion as any).mockResolvedValue(undefined);
    await expect(attributeConversion(999)).rejects.toThrow(/introuvable/i);
  });
});
