// L'agent lance Repenser avec les mêmes dépendances que la route (branchées par routes.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({ getCampaign: vi.fn(), getContent: vi.fn(), getProject: vi.fn() }));
vi.mock("../../storage", () => ({ storage: s }));
const lr = vi.hoisted(() => vi.fn());
vi.mock("./repenser", async (orig) => ({ ...(await orig<any>()), lancerRepenser: lr }));

const repenser = await import("./repenser");
const { outil } = await import("../agent/registre");
const ctx = { userId: "u1", maintenant: new Date("2026-11-02T09:00:00Z"), fuseau: "Europe/Paris" };
const executer = (args: any) => (outil("repenser_campagne") as any).aValider.executer(ctx, args);

beforeEach(() => {
  vi.clearAllMocks();
  s.getCampaign.mockResolvedValue({ id: 3, userId: "u1", name: "Saisons", status: "active" });
  s.getContent.mockResolvedValue([]);
  repenser.brancherRepenser(null);
});

describe("repenser_campagne — exécution", () => {
  it("sans dépendances branchées : échec lisible", async () => {
    expect(await executer({ campagneId: 3, consigne: "x" })).toEqual({ reussis: [], echecs: ["Repenser n'est pas disponible pour le moment"] });
  });

  it("lance Repenser avec la consigne, sans attendre la fin", async () => {
    const spy = lr.mockResolvedValue({ termine: new Promise(() => {}) });
    const deps = {} as any;
    repenser.brancherRepenser(deps);
    const b = await executer({ campagneId: 3, consigne: " deux par semaine " });
    expect(spy).toHaveBeenCalledWith(deps, "u1", 3, { consigne: "deux par semaine" });
    expect(b).toEqual({ reussis: ["Repenser « Saisons » est lancé : le nouveau plan arrive dans quelques minutes, dans la campagne"], echecs: [] });
  });

  it("déjà en cours : une ligne d'échec, pas d'exception", async () => {
    lr.mockRejectedValue(new repenser.DejaEnCours(3));
    repenser.brancherRepenser({} as any);
    expect(await executer({ campagneId: 3, consigne: "x" })).toEqual({ reussis: [], echecs: ["« Saisons » est déjà en train d'être repensée"] });
  });
});

describe("repenser_campagne — garde au moment du oui", () => {
  it("un post passé en publication auto : rien n'est lancé", async () => {
    s.getContent.mockResolvedValue([{ id: 1, title: "Post 1", publishedAt: null, postStatus: "pending", autoPost: true }]);
    repenser.brancherRepenser({} as any);
    const b = await executer({ campagneId: 3, consigne: "x" });
    expect(lr).not.toHaveBeenCalled();
    expect(b.echecs).toEqual(["« Post 1 » est programmé pour partir seul : Repenser le supprimerait"]);
  });
});
