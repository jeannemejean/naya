import { describe, it, expect } from "vitest";
import { updateLeadSchema } from "./schema";

describe("updateLeadSchema", () => {
  it("n'accepte pas le brief : il se modifie par sa route dédiée (qui réécrit les messages)", () => {
    const r = updateLeadSchema.parse({ notes: "x", prospectBrief: { declencheur: null } } as any);
    expect(r).not.toHaveProperty("prospectBrief");
    expect(r).toHaveProperty("notes", "x");
  });
});
