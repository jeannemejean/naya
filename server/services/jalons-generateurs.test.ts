// Chaque générateur de tâches passe ses tâches à la garde des jalons verrouillés, avec le bon
// projet. Les générateurs à dépendances par position (journée, mois, semaine, objectif) ne
// font que MARQUER : le retrait se fait dans filtrerTachesGenerees, qui garde les positions.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { marquer } from "./marques-jalons";

const garde = vi.hoisted(() => ({ marquerTachesDesJalonsVerrouilles: vi.fn(async () => 0) }));
vi.mock("./jalons-verrouilles", () => garde);
const claude = vi.hoisted(() => ({ callClaudeWithContext: vi.fn(), callClaudeDetailed: vi.fn() }));
vi.mock("./claude", async (orig) => ({ ...(await orig<any>()), callClaudeWithContext: claude.callClaudeWithContext, callClaudeDetailed: claude.callClaudeDetailed }));
vi.mock("./garde-langue", async (orig) => ({ ...(await orig<any>()), imposerLangueDuCompte: vi.fn(async () => 0), langueDuCompte: vi.fn(async () => "fr") }));
vi.mock("../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
const storage = vi.hoisted(() => ({
  getProjectGoal: vi.fn(async () => ({ id: 3, projectId: 7, title: "Signer 3 clients", description: "", targetValue: null, dueDate: null })),
  getProject: vi.fn(async () => ({ id: 7, name: "Lune" })),
  getBrandDna: vi.fn(async () => ({})),
  getBrandDnaForProject: vi.fn(async () => ({})),
  getProjectStrategyProfile: vi.fn(async () => null),
  getTasks: vi.fn(async () => []),
  getUserPreferences: vi.fn(async () => ({})),
}));
vi.mock("../storage", () => ({ storage: new Proxy(storage as any, { get: (t, k: string) => t[k] ?? (async () => null) }) }));

const { generateDailyTasks, generateMonthlyPlan, generateWeeklyRefinement, generateCampaignTasks } = await import("./openai");
const { generateGoalTasks } = await import("./goal-tasks");
const { genererRemplacement } = await import("./refus/remplacement");

const brandDna = { businessName: "Lune" } as any;
const projectContext = { projectId: 7, projectName: "Lune" } as any;
const tache = (title: string) => ({ title, description: "d", type: "planning", category: "business", priority: 2, estimatedDuration: 30, scheduledDate: "2026-10-20" });

beforeEach(() => { garde.marquerTachesDesJalonsVerrouilles.mockReset().mockResolvedValue(0); claude.callClaudeWithContext.mockReset(); claude.callClaudeDetailed.mockReset(); });

describe("chaque générateur passe par la garde des jalons verrouillés", () => {
  it("journée", async () => {
    claude.callClaudeWithContext.mockResolvedValue(JSON.stringify({ focus: "f", reasoning: "r", tasks: [tache("A")] }));
    const r = await generateDailyTasks({ userId: "u1", brandDna, recentContent: [], recentOutreach: [], weeklyGoals: {}, completedTasksToday: [], activeGoals: [], projectContext } as any);
    expect(garde.marquerTachesDesJalonsVerrouilles).toHaveBeenCalledWith(r.tasks, "u1", 7);
  });

  it("mois", async () => {
    claude.callClaudeWithContext.mockResolvedValue(JSON.stringify({ tasks: [tache("A")], dependencies: [] }));
    const r = await generateMonthlyPlan({ userId: "u1", brandDna, projectContext, goals: [], existingTaskCount: 0, targetMonth: "2026-10", todayFloor: "2026-10-15" } as any);
    expect(garde.marquerTachesDesJalonsVerrouilles).toHaveBeenCalledWith(r.tasks, "u1", 7);
  });

  it("semaine", async () => {
    claude.callClaudeWithContext.mockResolvedValue(JSON.stringify({ reschedules: [], newTasks: [tache("A")] }));
    const r = await generateWeeklyRefinement({ userId: "u1", brandDna, projectContext, goals: [], completedThisWeek: [], incompleteThisWeek: [], blockedChains: [], weekStart: "2026-10-19", weekEnd: "2026-10-25", todayFloor: "2026-10-15" } as any);
    expect(garde.marquerTachesDesJalonsVerrouilles).toHaveBeenCalledWith(r.newTasks, "u1", 7);
  });

  it("objectif", async () => {
    claude.callClaudeWithContext.mockResolvedValue(JSON.stringify({ tasks: [tache("A")] }));
    const r = await generateGoalTasks("u1", 3);
    expect(garde.marquerTachesDesJalonsVerrouilles).toHaveBeenCalledWith(r, "u1", 7);
  });

  it("campagne (sans dépendances par position) : la tâche marquée est retirée de la sortie", async () => {
    garde.marquerTachesDesJalonsVerrouilles.mockImplementation(async (ts: any[]) => { marquer(ts[1]); return 1; });
    claude.callClaudeDetailed.mockResolvedValue({ text: JSON.stringify({ tasks: [{ ...tache("A"), phase: 1 }, { ...tache("B"), phase: 1 }] }), stopReason: "end_turn", coutEur: 0 });
    const r = await generateCampaignTasks({ userId: "u1", projectId: 7, objective: "o", duration: "1_month", brandDna } as any, { phases: [], channels: [] } as any);
    expect(garde.marquerTachesDesJalonsVerrouilles.mock.calls[0][1]).toBe("u1");
    expect(garde.marquerTachesDesJalonsVerrouilles.mock.calls[0][2]).toBe(7);
    expect(r.map((t: any) => t.title)).toEqual(["A"]);
  });

  it("remplacement d'une tâche refusée : s'il sert un jalon verrouillé, aucun remplaçant", async () => {
    garde.marquerTachesDesJalonsVerrouilles.mockImplementation(async (ts: any[]) => { marquer(ts[0]); return 1; });
    claude.callClaudeWithContext.mockResolvedValue('{"title":"Préparer le lancement","description":"Desc","type":"planning","category":"business","estimatedDuration":30}');
    const r = await genererRemplacement({ userId: "u1", tache: { title: "X", projectId: 7 }, raison: "too_vague", refusRecents: [] } as any);
    expect(garde.marquerTachesDesJalonsVerrouilles.mock.calls[0][2]).toBe(7);
    expect(r).toBeNull();
  });
});
