import { describe, it, expect } from "vitest";
import { pickAllowedProjectFields, ALLOWED_PROJECT_PATCH_FIELDS } from "./project-fields";

describe("pickAllowedProjectFields — whitelist PATCH /api/projects/:id", () => {
  it("ne garde QUE les champs whitelistés", () => {
    const out = pickAllowedProjectFields({
      name: "Nouveau nom",
      priorityLevel: "primary",
      projectStatus: "active",
      description: "desc",
      // champs hors-liste / malveillants :
      userId: "evil-user",
      id: 999,
      isPrimary: true,
      slug: "hack",
      createdAt: "2020-01-01",
      foo: "bar",
    });
    expect(out).toEqual({
      name: "Nouveau nom",
      priorityLevel: "primary",
      projectStatus: "active",
      description: "desc",
    });
  });

  it("rejette (ignore) un champ hors-liste — userId/isPrimary/id ne passent jamais", () => {
    const out = pickAllowedProjectFields({ userId: "x", isPrimary: true, id: 1, hacked: true });
    expect(out).toEqual({});
    expect("userId" in out).toBe(false);
    expect("isPrimary" in out).toBe(false);
    expect("id" in out).toBe(false);
  });

  it("gère body vide / null sans planter", () => {
    expect(pickAllowedProjectFields(null)).toEqual({});
    expect(pickAllowedProjectFields(undefined)).toEqual({});
    expect(pickAllowedProjectFields({})).toEqual({});
  });

  it("liste des champs autorisés (référence)", () => {
    expect([...ALLOWED_PROJECT_PATCH_FIELDS]).toEqual([
      "name", "icon", "color", "type", "description", "monetizationIntent", "priorityLevel", "projectStatus",
    ]);
  });
});
