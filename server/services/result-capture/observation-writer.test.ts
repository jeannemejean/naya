import { describe, it, expect, vi } from "vitest";
import { rememberObservations } from "./observation-writer";
import { PREFIXE_CATEGORIE, PREFIXE_MOMENT } from "./observations";
import { SEUIL_PEREMPTION } from "./observation-memory";
import type { TaskAnswer } from "./insight";

const reponses: TaskAnswer[] = Array.from({ length: 6 }, () => ({
  category: "admin", scheduledHour: 10, done: false,
}));

/** Deux observations distinctes en un seul cycle : catégorie "admin" en échec, ET
 * un écart matin/après-midi sur "autre" — même fixture que
 * observations.test.ts:"observe le moment ET la categorie ensemble". */
const reponsesDeuxObservations: TaskAnswer[] = [
  ...Array.from({ length: 6 }, () => ({ category: "admin", scheduledHour: 10, done: false })),
  ...Array.from({ length: 6 }, () => ({ category: "autre", scheduledHour: 10, done: true })),
  ...Array.from({ length: 6 }, () => ({ category: "autre", scheduledHour: 15, done: false })),
];

function deps(over: Record<string, any> = {}) {
  return {
    lireVivantes: vi.fn().mockResolvedValue([]),
    lireCompteurs: vi.fn().mockResolvedValue([]),
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    inserer: vi.fn().mockResolvedValue(undefined),
    remplacer: vi.fn().mockResolvedValue(undefined),
    expirer: vi.fn().mockResolvedValue(undefined),
    majCompteur: vi.fn().mockResolvedValue(undefined),
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

  it("ecrit MEME quand le service d'embedding leve de facon SYNCHRONE (pas une promesse rejetee)", async () => {
    // Mineur de la revue finale : `d.embed(...).catch(() => null)` supposerait que
    // `embed` REND une promesse. Une dependance qui leve avant meme de retourner
    // quoi que ce soit doit quand meme etre rattrapee.
    const d = deps({
      embed: vi.fn(() => {
        throw new Error("leve avant de rendre une promesse");
      }),
    });
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

  it("lit quand meme la memoire vivante quand AUCUNE observation n'est produite ce cycle (ne court-circuite plus)", async () => {
    // Critique de la revue finale du 2026-09-16 : `if (observations.length === 0)
    // return;` empechait meme la LECTURE, donc empechait tout jamais de perimer un
    // motif disparu. Une fenetre sans aucune observation doit quand meme lire la
    // memoire vivante et ses compteurs.
    const d = deps();
    await rememberObservations("u1", [], d);
    expect(d.lireVivantes).toHaveBeenCalledTimes(1);
    expect(d.lireCompteurs).toHaveBeenCalledTimes(1);
  });

  it("deux observations dont la PREMIERE fait echouer inserer : la SECONDE est quand meme ecrite", async () => {
    // Important 4, mutation "supprimer le try/catch par observation" : sans ce
    // try/catch individuel, l'echec de l'ecriture de la premiere observation
    // interromprait la boucle et la seconde ne serait jamais tentee.
    const inserer = vi.fn()
      .mockRejectedValueOnce(new Error("premiere ecriture impossible"))
      .mockResolvedValue(undefined);
    const d = deps({ inserer });
    await rememberObservations("u1", reponsesDeuxObservations, d);
    expect(d.inserer).toHaveBeenCalledTimes(2);
    const contenus = d.inserer.mock.calls.map((c: any[]) => c[0].contenu as string);
    expect(contenus.some((c: string) => c.startsWith(PREFIXE_CATEGORIE("admin")))).toBe(true);
    expect(contenus.some((c: string) => c.startsWith(PREFIXE_MOMENT))).toBe(true);
  });

  describe("peremption d'un motif qui a cesse d'exister", () => {
    it("reconnait une memoire vivante d'un sujet ABSENT de la fenetre du jour (pas seulement les prefixes produits aujourd'hui)", async () => {
      // Critique, point 2 : "compta" n'apparait dans AUCUNE observation de ce
      // cycle (seul "admin" en produit une) — elle doit quand meme etre reconnue
      // comme mémoire vivante candidate a la peremption, jamais ignorée.
      const d = deps({
        lireVivantes: vi.fn().mockResolvedValue([
          { id: 99, content: `${PREFIXE_CATEGORIE("compta")} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.` },
        ]),
        lireCompteurs: vi.fn().mockResolvedValue([]),
      });
      await rememberObservations("u1", reponses, d);
      expect(d.majCompteur).toHaveBeenCalledWith("u1", PREFIXE_CATEGORIE("compta"), 1);
      expect(d.expirer).not.toHaveBeenCalled();
    });

    it("un seul passage sans le motif ne perime RIEN", async () => {
      const d = deps({
        lireVivantes: vi.fn().mockResolvedValue([
          { id: 99, content: `${PREFIXE_CATEGORIE("compta")} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.` },
        ]),
        lireCompteurs: vi.fn().mockResolvedValue([{ prefixe: PREFIXE_CATEGORIE("compta"), count: 3 }]),
      });
      await rememberObservations("u1", reponses, d);
      expect(d.expirer).not.toHaveBeenCalled();
      expect(d.majCompteur).toHaveBeenCalledWith("u1", PREFIXE_CATEGORIE("compta"), 4);
    });

    it("perime au SEUIL_PEREMPTION-ieme passage consecutif sans le motif, jamais avant", async () => {
      const dJusteAvant = deps({
        lireVivantes: vi.fn().mockResolvedValue([
          { id: 99, content: `${PREFIXE_CATEGORIE("compta")} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.` },
        ]),
        lireCompteurs: vi.fn().mockResolvedValue([
          { prefixe: PREFIXE_CATEGORIE("compta"), count: SEUIL_PEREMPTION - 2 },
        ]),
      });
      await rememberObservations("u1", reponses, dJusteAvant);
      expect(dJusteAvant.expirer).not.toHaveBeenCalled();

      const dAuSeuil = deps({
        lireVivantes: vi.fn().mockResolvedValue([
          { id: 99, content: `${PREFIXE_CATEGORIE("compta")} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.` },
        ]),
        lireCompteurs: vi.fn().mockResolvedValue([
          { prefixe: PREFIXE_CATEGORIE("compta"), count: SEUIL_PEREMPTION - 1 },
        ]),
      });
      await rememberObservations("u1", reponses, dAuSeuil);
      expect(dAuSeuil.expirer).toHaveBeenCalledWith(99);
      expect(dAuSeuil.majCompteur).toHaveBeenCalledWith("u1", PREFIXE_CATEGORIE("compta"), null);
    });

    it("un motif qui REAPPARAIT remet son compteur d'absence a zero, meme si le contenu est inchange (action \"rien\")", async () => {
      const d = deps({
        lireVivantes: vi.fn().mockResolvedValue([
          { id: 7, content: `${PREFIXE_CATEGORIE("admin")} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.` },
        ]),
        lireCompteurs: vi.fn().mockResolvedValue([
          { prefixe: PREFIXE_CATEGORIE("admin"), count: 250 },
        ]),
      });
      await rememberObservations("u1", reponses, d); // meme contenu -> action "rien"
      expect(d.inserer).not.toHaveBeenCalled();
      expect(d.remplacer).not.toHaveBeenCalled();
      expect(d.expirer).not.toHaveBeenCalled();
      expect(d.majCompteur).toHaveBeenCalledWith("u1", PREFIXE_CATEGORIE("admin"), null);
    });
  });
});
