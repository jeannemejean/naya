import { describe, it, expect, vi } from "vitest";
import { controleProjetCampagne } from "./campagne";

const deps = (enrolements: { leadId: number; status: string }[] = []) => ({
  getProject: vi.fn(async (id: number, u: string) => (u === "u" && (id === 7 || id === 5) ? { id } : undefined)),
  getEnrollmentsByCampaign: vi.fn(async () => enrolements),
});

describe("controleProjetCampagne", () => {
  it("projet non fourni : rien à contrôler", async () => {
    expect(await controleProjetCampagne({ userId: "u", corps: { name: "x" } }, deps())).toEqual({ ok: true, change: false });
  });
  it("projet d'une autre ou inconnu → 404", async () => {
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: 9 } }, deps())).toEqual({ ok: false, status: 404, message: "projet_introuvable" });
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: "abc" } }, deps())).toEqual({ ok: false, status: 404, message: "projet_introuvable" });
  });
  it("création : projet à elle accepté", async () => {
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: 7 } }, deps())).toEqual({ ok: true, change: true });
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: null } }, deps())).toEqual({ ok: true, change: true });
  });
  it("modification : changer de projet avec des séquences en cours → 409", async () => {
    const d = deps([{ leadId: 1, status: "active" }]);
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: 5 }, existante: { id: 3, projectId: 7 } }, d))
      .toEqual({ ok: false, status: 409, message: "campagne_en_cours" });
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: null }, existante: { id: 3, projectId: 7 } }, d))
      .toEqual({ ok: false, status: 409, message: "campagne_en_cours" });
  });
  it("modification : même projet, ou séquences toutes terminées → accepté", async () => {
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: 7 }, existante: { id: 3, projectId: 7 } }, deps([{ leadId: 1, status: "active" }])))
      .toEqual({ ok: true, change: false });
    expect(await controleProjetCampagne({ userId: "u", corps: { projectId: 5 }, existante: { id: 3, projectId: 7 } }, deps([{ leadId: 1, status: "completed" }])))
      .toEqual({ ok: true, change: true });
  });
});
