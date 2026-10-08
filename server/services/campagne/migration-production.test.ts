// Rattrapage des campagnes lancées avant la production dérivée des posts : retirer les
// anciennes sous-tâches anglaises non faites et sans post, puis créer les tâches reliées.
import { describe, it, expect, vi } from "vitest";
import { migrerProductionCampagne } from "./migration-production";

const post = (over: any = {}) => ({
  id: 50, userId: "u", projectId: 9, campaignId: 7, title: "Mon post", postFormat: "feed_image", contentType: "post",
  autoPost: false, scheduledFor: new Date("2026-10-16T11:00:00"), publishedAt: null, postStatus: "pending", contentStatus: "idea",
  ...over,
});
const tache = (id: number, title: string, over: any = {}) => ({
  id, userId: "u", campaignId: 7, contentId: null, completed: false, type: "content", title, scheduledDate: "2026-10-15", ...over,
});

function fabrique() {
  const taches = [
    tache(1, "Write copy — Write post one"),
    tache(2, "Angle & structure — Carousel"),
    tache(3, "Publish — Write post one", { completed: true }),          // faite : gardée
    tache(4, "Write copy — Other", { contentId: 12 }),                  // reliée : gardée
    tache(5, "Plan review", { type: "planning" }),                      // pas une sous-tâche
    tache(6, "Schedule — Newsletter", { type: "planning" }),            // pas de type content : gardée
    tache(7, "Rédiger le texte — Mon post", { contentId: 50, completed: true }),
  ];
  const placement = {
    getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
    getDayAvailabilityRange: vi.fn(async () => []),
    getTasksInRange: vi.fn(async () => taches),
    checkSlotAvailability: vi.fn(async () => ({ available: true })),
    createTask: vi.fn(async (t: any) => t),
    getContent: vi.fn(async () => [post(), post({ id: 51, postStatus: "posted" })]),
    getTasksForContents: vi.fn(async () => taches.filter((t) => t.contentId === 50)),
  };
  const deps = {
    placement,
    lireTachesCampagne: vi.fn(async () => taches),
    supprimerTaches: vi.fn(async (ids: number[]) => ids.length),
  };
  return { deps, placement };
}

describe("migrerProductionCampagne", () => {
  it("à blanc (défaut) : liste ce qui partirait et ce qui serait créé, n'écrit RIEN", async () => {
    const { deps, placement } = fabrique();
    const r = await migrerProductionCampagne(deps, { userId: "u", campaignId: 7, aujourdhui: "2026-10-08" });
    expect(r.applique).toBe(false);
    expect(r.aSupprimer.map((t) => t.id)).toEqual([1, 2]);
    expect(r.aCreer.map((t) => `${t.scheduledDate} ${t.title} #${t.contentId}`)).toEqual([
      "2026-10-15 Préparer le visuel — Mon post #50",
      "2026-10-15 Relire et valider le post — Mon post #50",
      "2026-10-16 Publier — Mon post #50",
    ]);
    expect(deps.supprimerTaches).not.toHaveBeenCalled();
    expect(placement.createTask).not.toHaveBeenCalled();
    expect(r).toMatchObject({ supprimees: 0, creees: 0 });
  });

  it("à blanc, les créneaux ignorent les tâches qui partiraient", async () => {
    const { deps } = fabrique();
    const r = await migrerProductionCampagne(deps, { userId: "u", campaignId: 7, aujourdhui: "2026-10-08" });
    // Les tâches 1 et 2 (le 15, sans heure) ne comptent pas ; rien d'autre n'a d'heure.
    expect(r.aCreer[0].scheduledTime).toBe("09:00");
  });

  it("--apply : supprime d'abord les anciennes sous-tâches, puis crée les tâches reliées", async () => {
    const { deps, placement } = fabrique();
    const ordre: string[] = [];
    deps.supprimerTaches.mockImplementation(async (ids: number[]) => { ordre.push("suppr"); return ids.length; });
    placement.createTask.mockImplementation(async (t: any) => { ordre.push("cree"); return t; });
    const r = await migrerProductionCampagne(deps, { userId: "u", campaignId: 7, aujourdhui: "2026-10-08", appliquer: true });
    expect(deps.supprimerTaches).toHaveBeenCalledWith([1, 2]);
    expect(ordre[0]).toBe("suppr");
    expect(placement.createTask).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ applique: true, supprimees: 2, creees: 3 });
  });
});
