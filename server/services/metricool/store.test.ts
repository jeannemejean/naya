import { describe, it, expect, vi } from "vitest";
process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
const ecrits: any[] = [];
vi.mock("../../db", () => ({ db: { insert: () => ({ values: (v: any) => { ecrits.push(v); return { onConflictDoUpdate: async (c: any) => { ecrits.push(c.set); } }; } }) } }));
const { enregistrerConnexionMetricool } = await import("./store");
const { isEncrypted } = await import("../token-crypto");

describe("connexion Metricool", () => {
  it("le jeton est chiffré au repos, jamais écrit en clair", async () => {
    await enregistrerConnexionMetricool("u1", { jeton: "secret-123", mcUserId: "1", blogId: "2" }, "ok", new Date());
    for (const v of ecrits) {
      expect(isEncrypted(v.jetonChiffre)).toBe(true);
      expect(JSON.stringify(v)).not.toContain("secret-123");
    }
  });
});
