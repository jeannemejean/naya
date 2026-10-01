import { describe, it, expect, vi } from "vitest";
import { tenterUneFois } from "./one-shot-guard";

/** Une promesse dont la résolution/rejet est déclenché depuis l'extérieur du test,
 * pour pouvoir observer précisément l'état PENDANT qu'une tâche est en vol. */
function creerPromesseControlee<T>() {
  let resoudre!: (v: T) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<T>((res, rej) => { resoudre = res; rejeter = rej; });
  return { promesse, resoudre, rejeter };
}

describe("tenterUneFois — garde anti-concurrence à un seul créneau", () => {
  it("un seul appel : exécute la tâche et rend sa valeur", async () => {
    const verrou = { current: false };
    const resultat = await tenterUneFois(verrou, async () => "ok");
    expect(resultat).toBe("ok");
  });

  it("le verrou se pose pendant l'exécution, et retombe après résolution", async () => {
    const verrou = { current: false };
    const { promesse, resoudre } = creerPromesseControlee<string>();
    const enVol = tenterUneFois(verrou, () => promesse);
    expect(verrou.current).toBe(true);
    resoudre("fini");
    await enVol;
    expect(verrou.current).toBe(false);
  });

  // LA GARANTIE CENTRALE : deux appels concurrents (le second déclenché AVANT que le
  // premier ait résolu) ne doivent jamais exécuter la tâche deux fois. C'est exactement
  // le double clic sur « créer et publier » : sans cette garde, le second clic écrivait
  // dans le même emplacement de ref que le premier avant que son onSuccess ne l'ait lu.
  it("un second appel déclenché PENDANT le premier est ignoré — la tâche n'est exécutée qu'une fois", async () => {
    const verrou = { current: false };
    const tache = vi.fn(() => creerPromesseControlee<string>().promesse);
    const premier = tenterUneFois(verrou, tache);
    const second = tenterUneFois(verrou, tache);

    expect(second).toBeNull();
    expect(tache).toHaveBeenCalledTimes(1);
    expect(premier).not.toBeNull();
  });

  it("après le succès du premier, un appel suivant est de nouveau accepté (le verrou n'est pas bloqué pour toujours)", async () => {
    const verrou = { current: false };
    await tenterUneFois(verrou, async () => "premier");
    const second = await tenterUneFois(verrou, async () => "second");
    expect(second).toBe("second");
  });

  it("après l'échec du premier (tâche qui rejette), le verrou est quand même relâché", async () => {
    const verrou = { current: false };
    await expect(tenterUneFois(verrou, async () => { throw new Error("échec"); })).rejects.toThrow("échec");
    expect(verrou.current).toBe(false);
    const second = await tenterUneFois(verrou, async () => "second");
    expect(second).toBe("second");
  });
});
