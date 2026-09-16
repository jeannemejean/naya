import { describe, it, expect, vi } from "vitest";
import { rememberObservations } from "./observation-writer";
import type { TaskAnswer } from "./insight";

const reponses: TaskAnswer[] = Array.from({ length: 6 }, () => ({
  category: "admin", scheduledHour: 10, done: false,
}));

function deps(over: Record<string, any> = {}) {
  return {
    lireVivantes: vi.fn().mockResolvedValue([]),
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    inserer: vi.fn().mockResolvedValue(undefined),
    remplacer: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("rememberObservations", () => {
  it("ecrit MEME quand l'embedding est indisponible", async () => {
    const d = deps({ embed: vi.fn().mockResolvedValue(null) });
    await rememberObservations("u1", reponses, d);
    expect(d.inserer).toHaveBeenCalledTimes(1);
    expect(d.inserer.mock.calls[0][0].embedding).toBeNull();
  });

  it("ecrit MEME quand le service d'embedding leve", async () => {
    const d = deps({ embed: vi.fn().mockRejectedValue(new Error("reseau")) });
    await rememberObservations("u1", reponses, d);
    expect(d.inserer).toHaveBeenCalledTimes(1);
    expect(d.inserer.mock.calls[0][0].embedding).toBeNull();
  });

  it("n'invalide JAMAIS une memoire qui ne correspond a aucun sujet courant", async () => {
    const d = deps({
      lireVivantes: vi.fn().mockResolvedValue([
        { id: 42, content: "Une memoire d'un tout autre sujet, sans rapport." },
      ]),
    });
    await rememberObservations("u1", reponses, d);
    expect(d.remplacer).not.toHaveBeenCalled();
    expect(d.inserer).toHaveBeenCalledTimes(1);
  });
});
