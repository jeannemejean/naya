import { describe, it, expect, vi } from "vitest";
import { enrolerEnMasse, type ProspectEnrolable } from "./prospection-enrolement";

const valide = new Date("2026-10-01T10:00:00Z");

function lead(id: number, over: Partial<ProspectEnrolable> = {}): ProspectEnrolable {
  return { id, stage: "messages_ready", validatedAt: valide, ...over };
}

describe("enrolerEnMasse — la barrière vaut aussi pour l'enrôlement groupé", () => {
  it("n'enrôle que les prospects validés à l'étape messages_ready", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const r = await enrolerEnMasse({
      leads: [
        lead(1),
        lead(2, { validatedAt: null }),
        lead(3, { stage: "identified" }),
        lead(4, { stage: "connection_sent" }),
      ],
      getState: async () => undefined,
      enroll,
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith(1);
    expect(r).toEqual({ enrolled: 1, skipped: 3, skippedNotValidated: 3, total: 4 });
  });

  it("ne ré-enrôle jamais un état actif, terminé ou ayant répondu", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const states: Record<number, { status: string }> = {
      1: { status: "active" },
      2: { status: "stopped_replied" },
      3: { status: "completed" },
      4: { status: "paused" },
    };
    const r = await enrolerEnMasse({
      leads: [lead(1), lead(2), lead(3), lead(4)],
      getState: async (id) => states[id],
      enroll,
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith(4);
    expect(r.enrolled).toBe(1);
    expect(r.skipped).toBe(3);
    expect(r.skippedNotValidated).toBe(0);
  });

  it("compte comme ignoré un enrôlement refusé par le stockage", async () => {
    const r = await enrolerEnMasse({
      leads: [lead(1)],
      getState: async () => undefined,
      enroll: async () => undefined,
    });
    expect(r).toEqual({ enrolled: 0, skipped: 1, skippedNotValidated: 0, total: 1 });
  });

  it("une date de validation invalide ne vaut pas validation", async () => {
    const enroll = vi.fn(async (_id: number) => ({}));
    const r = await enrolerEnMasse({
      leads: [lead(1, { validatedAt: new Date("x") })],
      getState: async () => undefined,
      enroll,
    });
    expect(enroll).not.toHaveBeenCalled();
    expect(r.skippedNotValidated).toBe(1);
  });
});
