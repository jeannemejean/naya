import { describe, it, expect } from "vitest";
import { normalizeReceptionImportErrors, type ReceptionImportRawError } from "./reception-import-errors";

describe("normalizeReceptionImportErrors — mélange erreurs de parsing / erreurs d'ingestion", () => {
  it("reconnaît une erreur de parsing (porte `line`) comme kind 'line'", () => {
    const rows = normalizeReceptionImportErrors([{ line: 3, message: "platform manquant" }]);
    expect(rows).toEqual([{ key: "line-3-0", kind: "line", line: 3, message: "platform manquant" }]);
  });

  it("reconnaît une erreur d'ingestion (pas de `line`) comme kind 'content'", () => {
    const rows = normalizeReceptionImportErrors([
      { contentId: 42, platform: "instagram", message: "contenu introuvable" },
    ]);
    expect(rows).toEqual([
      { key: "content-42-instagram-0", kind: "content", contentId: 42, platform: "instagram", message: "contenu introuvable" },
    ]);
  });

  it("ne suppose jamais que `line` existe : une entrée d'ingestion sans `line` ne casse pas", () => {
    const raw: ReceptionImportRawError[] = [{ contentId: 1, platform: "linkedin", message: "échec" }];
    expect(() => normalizeReceptionImportErrors(raw)).not.toThrow();
    expect(normalizeReceptionImportErrors(raw)[0].kind).toBe("content");
  });

  it("ne perd aucune entrée : un mélange des deux formes conserve le compte et l'ordre", () => {
    const raw: ReceptionImportRawError[] = [
      { line: 2, message: "content_id invalide" },
      { contentId: 7, platform: "facebook", message: "contenu sans marque" },
      { line: 5, message: "reach invalide" },
    ];
    const rows = normalizeReceptionImportErrors(raw);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.kind)).toEqual(["line", "content", "line"]);
    expect(rows.map((r) => r.message)).toEqual(["content_id invalide", "contenu sans marque", "reach invalide"]);
  });

  it("génère des clés uniques même pour des numéros de ligne ou des contenus dupliqués", () => {
    const raw: ReceptionImportRawError[] = [
      { line: 2, message: "erreur A" },
      { line: 2, message: "erreur B" },
      { contentId: 9, platform: "linkedin", message: "erreur C" },
      { contentId: 9, platform: "linkedin", message: "erreur D" },
    ];
    const keys = normalizeReceptionImportErrors(raw).map((r) => r.key);
    expect(new Set(keys).size).toBe(4);
  });

  it("tableau vide → aucune ligne", () => {
    expect(normalizeReceptionImportErrors([])).toEqual([]);
  });
});
