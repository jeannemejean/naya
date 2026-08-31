import { describe, it, expect } from "vitest";
import { parseReceptionCsv } from "./sources/manual";
import { instagramSource } from "./sources/instagram";

describe("parseReceptionCsv", () => {
  it("lit une ligne complète", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,shares,comments,reach,measured_at\n42,instagram,10,3,5,1000,2026-08-15",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ contentId: 42, platform: "instagram", saves: 10, reach: 1000 });
  });

  it("reporte les erreurs LIGNE PAR LIGNE sans jeter le reste du fichier", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,reach\n42,instagram,10,1000\nabc,instagram,5,500\n43,instagram,7,900",
    );
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(3);
    expect(r.errors[0].message).toBeTruthy();
  });

  it("refuse un fichier sans les colonnes obligatoires", () => {
    const r = parseReceptionCsv("saves,reach\n10,1000");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message.toLowerCase()).toContain("content_id");
  });

  it("laisse un signal absent à null plutôt que de le mettre à zéro", () => {
    const r = parseReceptionCsv("content_id,platform,saves,reach\n42,instagram,,1000");
    expect(r.rows[0].saves).toBeNull();
  });

  it("normalise measured_at au jour", () => {
    const r = parseReceptionCsv(
      "content_id,platform,reach,measured_at\n42,instagram,1000,2026-08-15T13:45:00Z",
    );
    expect(r.rows[0].measuredAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("rejette une valeur négative", () => {
    const r = parseReceptionCsv("content_id,platform,saves,reach\n42,instagram,-3,1000");
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it("compte les vraies lignes du fichier source, lignes vides comprises", () => {
    // Ligne 1 : en-tête. Ligne 2 : donnée valide. Ligne 3 : ligne vide (fréquente dans un
    // export/CSV édité à la main). Ligne 4 : donnée invalide — l'erreur doit désigner la
    // ligne 4, pas la ligne 3 (qui serait le résultat d'un comptage naïf ignorant le vide).
    const r = parseReceptionCsv(
      "content_id,platform,saves,reach\n42,instagram,10,1000\n\nabc,instagram,5,500",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(4);
  });

  it("laisse sentiment_score à null si la colonne est absente ou la cellule vide", () => {
    const sansColonne = parseReceptionCsv("content_id,platform,reach\n42,instagram,1000");
    expect(sansColonne.rows[0].sentimentScore).toBeNull();

    const celluleVide = parseReceptionCsv(
      "content_id,platform,reach,sentiment_score\n42,instagram,1000,",
    );
    expect(celluleVide.rows[0].sentimentScore).toBeNull();
  });

  it("rejette un sentiment_score hors de l'intervalle -1..1", () => {
    const r = parseReceptionCsv(
      "content_id,platform,reach,sentiment_score\n42,instagram,1000,1.5",
    );
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it("gère les fins de ligne Windows (\\r\\n) sans faire traîner de \\r dans les en-têtes", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,reach\r\n42,instagram,10,1000\r\n",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ contentId: 42, platform: "instagram", saves: 10, reach: 1000 });
  });
});

describe("adaptateur Instagram", () => {
  it("refuse d'être utilisé et NOMME la permission manquante", async () => {
    await expect(instagramSource.fetchSignals({ contentId: 1, platformPostId: "x" }))
      .rejects.toThrow(/instagram_business_manage_insights/);
  });
});
