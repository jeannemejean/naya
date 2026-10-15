// Règle non négociable (CLAUDE.md) : Naya ne génère JAMAIS de tâches pour un jalon `locked`.
// La phrase du prompt ne suffit pas : cette garde vérifie après coup, indépendamment.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { marquerTachesDesJalonsVerrouilles, type DepsJalons } from "./jalons-verrouilles";
import { estPourJalonVerrouille } from "./marques-jalons";
import { filtrerTachesGenerees } from "./filtre-taches-generees";

const LANCEMENT = { id: 12, title: "Lancer la formation", description: "Ouverture des inscriptions" };

function deps(over: Partial<DepsJalons> = {}): DepsJalons {
  return {
    jalonsVerrouilles: vi.fn(async () => [LANCEMENT]),
    verifier: vi.fn(async () => ({ taches: [{ index: 1, jalonId: 12 }, { index: 0, jalonId: null }] })),
    ...over,
  };
}

const lot = () => [
  { title: "Répondre aux mails clients", description: "" },
  { title: "Écrire la page de vente de la formation", description: "" },
];

beforeEach(() => vi.restoreAllMocks());

describe("marquerTachesDesJalonsVerrouilles", () => {
  it("aucun jalon verrouillé : aucun appel au modèle, rien n'est marqué", async () => {
    const d = deps({ jalonsVerrouilles: vi.fn(async () => []) });
    const t = lot();
    expect(await marquerTachesDesJalonsVerrouilles(t, "u1", 7, d)).toBe(0);
    expect(d.verifier).not.toHaveBeenCalled();
    expect(t.some(estPourJalonVerrouille)).toBe(false);
  });

  it("aucune tâche : rien n'est lu", async () => {
    const d = deps();
    expect(await marquerTachesDesJalonsVerrouilles([], "u1", 7, d)).toBe(0);
    expect(await marquerTachesDesJalonsVerrouilles(null, "u1", 7, d)).toBe(0);
    expect(d.jalonsVerrouilles).not.toHaveBeenCalled();
  });

  it("marque la tâche qui fait avancer un jalon verrouillé, et elle seule", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = lot();
    const d = deps();
    expect(await marquerTachesDesJalonsVerrouilles(t, "u1", 7, d)).toBe(1);
    expect(estPourJalonVerrouille(t[1])).toBe(true);
    expect(estPourJalonVerrouille(t[0])).toBe(false);
    expect(d.jalonsVerrouilles).toHaveBeenCalledWith("u1", 7);
    const entree = (d.verifier as any).mock.calls[0][0];
    expect(entree.jalons).toEqual([LANCEMENT]);
    expect(entree.taches.map((x: any) => x.index)).toEqual([0, 1]);
  });

  it("ignore un index ou un jalon inventé par le modèle", async () => {
    const t = lot();
    const d = deps({ verifier: vi.fn(async () => ({ taches: [{ index: 9, jalonId: 12 }, { index: 0, jalonId: 99 }] })) });
    expect(await marquerTachesDesJalonsVerrouilles(t, "u1", 7, d)).toBe(0);
    expect(t.some(estPourJalonVerrouille)).toBe(false);
  });

  it("la vérification échoue : on laisse passer (choix A de Jeanne), et on le journalise", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = lot();
    const d = deps({ verifier: vi.fn(async () => { throw new Error("API down"); }) });
    expect(await marquerTachesDesJalonsVerrouilles(t, "u1", 7, d)).toBe(0);
    expect(t.some(estPourJalonVerrouille)).toBe(false);
    expect(err).toHaveBeenCalled();
  });
});

describe("filtrerTachesGenerees retire les tâches marquées", () => {
  it("une tâche marquée pour un jalon verrouillé est écartée, les autres gardées dans l'ordre", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = lot();
    await marquerTachesDesJalonsVerrouilles(t, "u1", 7, deps());
    expect(filtrerTachesGenerees(t, "test")).toEqual([t[0]]);
  });

  it("fonctionne aussi quand la tâche est enveloppée (accès personnalisé)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = lot();
    await marquerTachesDesJalonsVerrouilles(t, "u1", 7, deps());
    const enveloppees = t.map((taskData) => ({ taskData }));
    expect(filtrerTachesGenerees(enveloppees, "test", (p) => p.taskData)).toEqual([enveloppees[0]]);
  });
});
