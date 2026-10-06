// Bornes (pages, temps) et libération du document : unpdf mocké.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const destroy = vi.fn(async () => {});
const getDocumentProxy = vi.fn();
const extractText = vi.fn();
vi.mock("unpdf", () => ({ getDocumentProxy, extractText }));

const { extraireTextePdf } = await import("./extraire-pdf");
const pdf = Buffer.from("%PDF-1.4 x");
const long = "mot ".repeat(100);

describe("extraireTextePdf : bornes et destroy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentProxy.mockResolvedValue({ numPages: 3, loadingTask: { destroy } });
  });
  afterEach(() => vi.useRealTimers());

  it("ok : le document est détruit", async () => {
    extractText.mockResolvedValue({ text: long });
    expect((await extraireTextePdf(pdf)).statut).toBe("ok");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("pas_de_texte : détruit", async () => {
    extractText.mockResolvedValue({ text: "peu" });
    expect((await extraireTextePdf(pdf)).statut).toBe("pas_de_texte");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("501 pages : illisible, sans extraction, détruit", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 501, loadingTask: { destroy } });
    expect((await extraireTextePdf(pdf)).statut).toBe("illisible");
    expect(extractText).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("500 pages : accepté", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 500, loadingTask: { destroy } });
    extractText.mockResolvedValue({ text: long });
    expect((await extraireTextePdf(pdf)).statut).toBe("ok");
  });

  it("erreur d'extraction : illisible, détruit", async () => {
    extractText.mockRejectedValue(new Error("boom"));
    expect((await extraireTextePdf(pdf)).statut).toBe("illisible");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("délai dépassé : illisible, détruit", async () => {
    vi.useFakeTimers();
    extractText.mockReturnValue(new Promise(() => {}));
    const p = extraireTextePdf(pdf);
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await p).statut).toBe("illisible");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("échec d'ouverture : illisible (rien à détruire)", async () => {
    getDocumentProxy.mockRejectedValue(new Error("corrompu"));
    expect((await extraireTextePdf(pdf)).statut).toBe("illisible");
    expect(destroy).not.toHaveBeenCalled();
  });
});
