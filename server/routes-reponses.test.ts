import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.UNSUBSCRIBE_SECRET = "secret-de-test";
const storageMock = { updateLeadSequenceState: vi.fn(async () => ({})) };
vi.mock("./storage", () => ({ storage: storageMock }));
vi.mock("./auth", () => ({ isAuthenticated: (_q: any, res: any) => res.status(401).json({}) }));

const { registerReponsesRoutes } = await import("./routes-reponses");
const { jetonDesinscription } = await import("./services/desinscription");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
registerReponsesRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string) => fetch(`http://127.0.0.1:${port}${path}`, { method });

beforeEach(() => vi.clearAllMocks());

describe("routes publiques de désinscription", () => {
  it("GET : page en français avec un formulaire POST, sans auth, et ne désinscrit JAMAIS", async () => {
    const r = await appel("GET", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Se désinscrire");
    expect(html).toContain('method="post"');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3)/);
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });
  it("POST : état unsubscribed définitif + page de confirmation", async () => {
    const r = await appel("POST", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("désinscrit");
    expect(storageMock.updateLeadSequenceState).toHaveBeenCalledWith(9, { status: "unsubscribed", nextRunAt: null });
  });
  it("jeton invalide : 404 sur GET et POST, rien d'écrit", async () => {
    expect((await appel("GET", "/desinscription/bidon")).status).toBe(404);
    expect((await appel("POST", "/desinscription/9.bidon")).status).toBe(404);
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });
});
