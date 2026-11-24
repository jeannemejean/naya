// Rattrapage des posts oubliés : un post « à finir sur le téléphone » n'est jamais passé en
// échec par le worker (il attend la main de l'utilisatrice). Base simulée : on lit le SQL généré.
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ wheres: [] as any[] }));
vi.mock("../storage", () => ({ storage: { getDueScheduledContent: vi.fn(async () => []), getProcessingContent: vi.fn(async () => []) } }));
vi.mock("./social-publishers", () => ({ publishPost: vi.fn(), igFinishAsync: vi.fn(), tiktokFinishAsync: vi.fn(), publierPremierCommentaire: vi.fn() }));
vi.mock("./social-integrations", () => ({ socialMediaService: {} }));
vi.mock("./connexions/comptes", () => ({ compteDePublication: vi.fn() }));
vi.mock("../db", () => {
  const chaine = (): any => {
    const suite: any = {
      from: () => suite, set: () => suite, limit: () => suite, returning: () => suite, orderBy: () => suite,
      where: (w: any) => { h.wheres.push(w); return suite; },
      then: (ok: any, ko: any) => Promise.resolve([]).then(ok, ko),
    };
    return suite;
  };
  return { db: { select: () => chaine(), update: () => chaine() } };
});

const { publishDueContent } = await import("./social-publisher");

describe("rattraperOublies", () => {
  it("ne passe jamais en échec un post « à finir sur le téléphone »", async () => {
    await publishDueContent();
    const requetes = h.wheres.map((w) => new PgDialect().sqlToQuery(w).sql);
    const manques = requetes.find((q) => q.includes('"content"."auto_post"') && q.includes('"content"."scheduled_for" <'));
    expect(manques).toBeDefined();
    expect(manques).toContain('"content"."finir_sur_telephone"');
  });
});
