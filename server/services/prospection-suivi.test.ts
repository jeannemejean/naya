// Suivi de santé de l'envoi de prospection : seul un vrai passage est suivi (jamais un tour
// bloqué par la garde), et une base en panne est une erreur, pas un succès.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ due: vi.fn(), suivre: vi.fn(), bloquer: null as null | Promise<void> }));
vi.mock("../storage", () => ({ storage: { getDueEnrollments: h.due } }));
vi.mock("./fil/etat-taches-fond", () => ({ suivrePassage: h.suivre }));
vi.mock("./unipile-mail", () => ({ sendEmailUnipile: vi.fn() }));
vi.mock("./sequence-message", () => ({}));
vi.mock("./linkedin", () => ({}));

const { runProspectionSender } = await import("./prospection-sender");

beforeEach(() => {
  h.due.mockReset(); h.suivre.mockReset(); h.bloquer = null;
  h.suivre.mockImplementation(async (_n: string, fn: () => Promise<unknown>) => { if (h.bloquer) await h.bloquer; return fn(); });
});

describe("runProspectionSender : suivi", () => {
  it("rien d'échu : un passage suivi, qui réussit", async () => {
    h.due.mockResolvedValue([]);
    await runProspectionSender();
    expect(h.suivre).toHaveBeenCalledTimes(1);
    expect(h.suivre.mock.calls[0][0]).toBe("envoi_prospection");
  });

  it("un tour bloqué par la garde n'écrit rien", async () => {
    let liberer!: () => void;
    h.bloquer = new Promise<void>((ok) => { liberer = ok; });
    h.due.mockResolvedValue([]);
    const p1 = runProspectionSender();
    await runProspectionSender();
    expect(h.suivre).toHaveBeenCalledTimes(1);
    liberer();
    await p1;
  });

  it("base en panne : l'erreur remonte au suivi, la garde est relâchée et le tour suivant repart", async () => {
    h.due.mockRejectedValueOnce(new Error("base indisponible"));
    await expect(runProspectionSender()).rejects.toThrow("base indisponible");
    h.due.mockResolvedValue([]);
    await expect(runProspectionSender()).resolves.toBeUndefined();
    expect(h.suivre).toHaveBeenCalledTimes(2);
  });
});
