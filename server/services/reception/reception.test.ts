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

  it("garde `0` comme zéro MESURÉ pour saves/shares/comments/reach — jamais confondu avec l'absence", () => {
    // La règle centrale de cette tâche fonctionne dans les deux sens : une cellule vide est
    // `null` (testé plus haut), une cellule `0` reste `0`. Une implémentation du type
    // `Number(trimmed) || null` casserait silencieusement CE côté-ci de la règle (0 est
    // falsy en JS) sans qu'aucun test n'échoue si seul le côté "vide → null" est couvert.
    const r = parseReceptionCsv(
      "content_id,platform,saves,shares,comments,reach\n42,instagram,0,0,0,0",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ saves: 0, shares: 0, comments: 0, reach: 0 });
  });

  it("accepte un en-tête entre guillemets (export tableur courant)", () => {
    const r = parseReceptionCsv(
      '"content_id","platform","saves","reach"\n42,instagram,10,1000',
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ contentId: 42, platform: "instagram", saves: 10, reach: 1000 });
  });

  it("reconnaît une ligne de champs vides ENTRE GUILLEMETS comme vide, sans désynchroniser la numérotation", () => {
    // `"","",""`  n'est pas vide pour un split(",") naïf (les jetons sont `""`, deux
    // guillemets littéraux, pas une chaîne vide) mais L'EST pour le vrai tokeniseur CSV
    // (guillemets ouverts puis aussitôt fermés = champ vide). Si la détection de ligne vide
    // ne s'accorde pas avec `parseCsv`, cette ligne occupe une place ici mais pas dans le
    // tableau de parseCsv : tous les numéros de ligne qui suivent se décalent.
    const r = parseReceptionCsv(
      'content_id,platform,saves,reach\n42,instagram,10,1000\n"","",""\nabc,instagram,5,500',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(4);
  });

  it("ignore plusieurs lignes vides consécutives sans décaler la numérotation", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,reach\n42,instagram,10,1000\n\n\n\nabc,instagram,5,500",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(6);
  });

  it("ignore une ligne vide finale sans produire d'erreur ni de ligne fantôme", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,reach\n42,instagram,10,1000\n\n",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  it("signale clairement une ligne vide AVANT l'en-tête plutôt que de mal l'interpréter", () => {
    const r = parseReceptionCsv(
      "\ncontent_id,platform,saves,reach\n42,instagram,10,1000",
    );
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(1);
    expect(r.errors[0].message.toLowerCase()).toContain("vide");
  });

  it("extrait le jour calendaire de measured_at SANS dépendre du fuseau du serveur", () => {
    // "2026-08-15 01:00:00" (sans décalage explicite) serait lu comme une heure LOCALE par
    // `new Date(string)` : sur un serveur en UTC+2 (ex. Europe/Paris l'été), 01h locale le
    // 15 correspond à 23h UTC le 14 — un jour calendaire faux. L'extraction lexicale ne doit
    // jamais dépendre de ça.
    const r = parseReceptionCsv(
      "content_id,platform,reach,measured_at\n42,instagram,1000,2026-08-15 01:00:00",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0].measuredAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("rejette un measured_at qui n'est pas une date calendaire valide", () => {
    const r = parseReceptionCsv(
      "content_id,platform,reach,measured_at\n42,instagram,1000,2026-13-40",
    );
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("adaptateur Instagram", () => {
  it("refuse d'être utilisé et NOMME la permission manquante", async () => {
    await expect(instagramSource.fetchSignals({ contentId: 1, platformPostId: "x" }))
      .rejects.toThrow(/instagram_business_manage_insights/);
  });
});
