// generateDailyTasks et le fil conducteur : avec `filConducteur`, le prompt liste l'étape en
// cours de chaque objectif (et son pourquoi) et demande etapeIndex + pourquoi. Sans : prompt
// strictement inchangé.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./jalons-verrouilles", () => ({ marquerTachesDesJalonsVerrouilles: vi.fn(async () => 0) }));
const claude = vi.hoisted(() => ({ callClaudeWithContext: vi.fn() }));
vi.mock("./claude", async (orig) => ({ ...(await orig<any>()), callClaudeWithContext: claude.callClaudeWithContext }));
vi.mock("./garde-langue", async (orig) => ({ ...(await orig<any>()), imposerLangueDuCompte: vi.fn(async () => 0), langueDuCompte: vi.fn(async () => "fr") }));
vi.mock("../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("../storage", () => ({ storage: new Proxy({} as any, { get: () => async () => null }) }));

const { generateDailyTasks } = await import("./openai");

const base = {
  userId: "u1", brandDna: { businessName: "Lune" }, recentContent: [], recentOutreach: [], weeklyGoals: {},
  completedTasksToday: [], projectContext: { projectId: 7, projectName: "Lune" },
} as any;
const goal = { id: 1, title: "Signer 3 clients", successMode: "revenue", goalType: "revenue", dueDate: null };
const prompt = () => claude.callClaudeWithContext.mock.calls[0][0].userMessage as string;

beforeEach(() => {
  claude.callClaudeWithContext.mockReset().mockResolvedValue(JSON.stringify({
    focus: "f", reasoning: "r",
    tasks: [{ title: "A", goalIndex: 0, etapeIndex: 0, pourquoi: "Sans ce devis signé, l'étape « 1er client » reste bloquée" }],
  }));
});

describe("generateDailyTasks — fil conducteur", () => {
  it("avec le fil : étape en cours + pourquoi dans le prompt, etapeIndex et pourquoi demandés et renvoyés", async () => {
    const r = await generateDailyTasks({
      ...base, filConducteur: true,
      activeGoals: [{ ...goal, etapes: [{ titre: "1er client IN SCENA", pourquoi: "Un client signé prouve l'offre" }] }],
    });
    expect(prompt()).toContain(`[0] "1er client IN SCENA" — why: Un client signé prouve l'offre`);
    expect(prompt()).toContain(`"etapeIndex": 0`);
    expect(prompt()).toContain(`"pourquoi":`);
    expect(prompt()).toContain("never default to 0");
    expect(r.tasks[0]).toMatchObject({ goalIndex: 0, etapeIndex: 0 });
    expect(r.tasks[0].pourquoi).toMatch(/devis/);
  });

  it("objectif sans étape en cours : le prompt le dit", async () => {
    await generateDailyTasks({ ...base, filConducteur: true, activeGoals: [{ ...goal, etapes: [] }] });
    expect(prompt()).toContain("current step(s): none");
  });

  it("sans le fil : le prompt est identique à celui d'avant (ni étape, ni pourquoi)", async () => {
    await generateDailyTasks({ ...base, activeGoals: [goal] });
    const p = prompt();
    expect(p).not.toContain("etapeIndex");
    expect(p).not.toContain("pourquoi");
    expect(p).not.toContain("current step");
    expect(p).toContain(`[0] "Signer 3 clients" — type: revenue, success mode: revenue\n`);
    expect(p).toContain(`"goalIndex": 0,\n      "title":`);
    expect(p).toContain("or 0 if no goals provided.\n\n");
  });
});
