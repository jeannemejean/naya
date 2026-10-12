import { describe, it, expect } from "vitest";
import { toDraft, payloadSequence } from "./sequence-draft";

describe("brouillon de séquence", () => {
  it("garde le rôle de chaque étape à l'aller et au retour", () => {
    const dto = { id: 1, stepOrder: 1, channel: "linkedin", delayDays: 6, intention: "Clore", condition: "if_invite_accepted", subjectTemplate: null, bodyTemplate: null, role: "cloture" };
    const draft = toDraft(dto as any);
    expect(draft.role).toBe("cloture");
    const [p] = payloadSequence([{ ...draft, delayDays: 7 }]);
    expect(p).toEqual({ id: 1, stepOrder: 1, channel: "linkedin", delayDays: 7, intention: "Clore", condition: "if_invite_accepted", role: "cloture" });
  });
  it("une étape ajoutée à la main n'a pas de rôle (le serveur le déduit)", () => {
    const [p] = payloadSequence([{ channel: "email", delayDays: 2, intention: "x", condition: "always" }]);
    expect(p.role).toBeNull();
  });
});
