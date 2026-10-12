// Routes de la bibliothèque de preuves : propriété vérifiée et validation des champs.
// `./storage` et `./auth` sont mockés : aucune requête réelle.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));

const storageMock = {
  getProject: vi.fn(),
  getProjectProofs: vi.fn(async () => []),
  getProjectProof: vi.fn(),
  createProjectProof: vi.fn(async (row: any) => ({ id: 9, ...row })),
  updateProjectProof: vi.fn(async (id: number, _u: string, patch: any) => ({ id, ...patch })),
  deleteProjectProof: vi.fn(async () => true),
};
vi.mock("./storage", () => ({ storage: storageMock }));
vi.mock("./services/prospection/preuves-suggestion", () => ({
  suggererPreuves: vi.fn(async () => ({ creees: 2, sourcesEchouees: [] })),
}));

const { registerPreuvesRoutes } = await import("./routes-preuves");

const app = express();
app.use(express.json());
registerPreuvesRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());

const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getProject.mockImplementation(async (id: number) => (id === 7 ? { id: 7, userId: "user-1" } : undefined));
  storageMock.getProjectProof.mockImplementation(async (id: number) => (id === 3 ? { id: 3, projectId: 7, userId: "user-1" } : undefined));
});

describe("routes des preuves", () => {
  it("404 sur le projet d'une autre utilisatrice", async () => {
    expect((await appel("GET", "/api/projects/8/proofs")).status).toBe(404);
    expect((await appel("POST", "/api/projects/8/proofs", { clientLabel: "a", whatWasDone: "b" })).status).toBe(404);
    expect(storageMock.createProjectProof).not.toHaveBeenCalled();
  });

  it("crée une preuve validée par défaut quand l'utilisatrice la saisit elle-même", async () => {
    const r = await appel("POST", "/api/projects/7/proofs", { clientLabel: "Studio Nord", whatWasDone: "Lancement" });
    expect(r.status).toBe(201);
    expect(storageMock.createProjectProof).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1", projectId: 7, status: "validated", source: "manual",
    }));
  });

  it("400 sur un statut inconnu ou une URL non http", async () => {
    expect((await appel("POST", "/api/projects/7/proofs", { clientLabel: "a", whatWasDone: "b", status: "x" })).status).toBe(400);
    expect((await appel("POST", "/api/projects/7/proofs", { clientLabel: "a", whatWasDone: "b", url: "javascript:alert(1)" })).status).toBe(400);
  });

  it("404 en modification d'une preuve d'un autre projet", async () => {
    expect((await appel("PATCH", "/api/projects/7/proofs/4", { status: "validated" })).status).toBe(404);
    const ok = await appel("PATCH", "/api/projects/7/proofs/3", { status: "validated" });
    expect(ok.status).toBe(200);
  });

  it("suggestion : renvoie le nombre de propositions créées", async () => {
    const r = await appel("POST", "/api/projects/7/proofs/suggest");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ creees: 2, sourcesEchouees: [] });
  });
});
