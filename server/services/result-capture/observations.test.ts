import { describe, it, expect } from "vitest";
import { extractObservations, prefixeDeContenu, PREFIXE_CATEGORIE, PREFIXE_MOMENT } from "./observations";
import { MIN_OBSERVATIONS } from "./insight";
import type { TaskAnswer } from "./insight";

const rep = (category: string | null, scheduledHour: number, done: boolean): TaskAnswer =>
  ({ category, scheduledHour, done });

describe("extractObservations", () => {
  it("ne dit rien sous le seuil d'observations", () => {
    expect(extractObservations([rep("admin", 10, false)])).toEqual([]);
  });

  it("observe une categorie qui ne passe pas", () => {
    const answers = Array.from({ length: 6 }, () => rep("admin", 10, false));
    const obs = extractObservations(answers);
    expect(obs).toHaveLength(1);
    expect(obs[0].prefixe).toBe(PREFIXE_CATEGORIE("admin"));
    expect(obs[0].contenu.startsWith(PREFIXE_CATEGORIE("admin"))).toBe(true);
    expect(obs[0].appuis).toBe(6);
  });

  it("ne cite jamais une categorie inconnue", () => {
    const answers = Array.from({ length: 6 }, () => rep(null, 10, false));
    expect(extractObservations(answers)).toEqual([]);
  });

  it("observe DEUX categories distinctes, sans s'arreter a la premiere", () => {
    const answers = [
      ...Array.from({ length: 6 }, () => rep("admin", 10, false)),
      ...Array.from({ length: 6 }, () => rep("compta", 10, false)),
    ];
    const prefixes = extractObservations(answers).map((o) => o.prefixe).sort();
    expect(prefixes).toEqual([PREFIXE_CATEGORIE("admin"), PREFIXE_CATEGORIE("compta")].sort());
  });

  it("observe le moment ET la categorie ensemble — la premiere ne masque pas la seconde", () => {
    const answers = [
      ...Array.from({ length: 6 }, () => rep("admin", 10, false)), // categorie en echec, le matin
      ...Array.from({ length: 6 }, () => rep("autre", 10, true)),  // matin qui tient
      ...Array.from({ length: 6 }, () => rep("autre", 15, false)), // apres-midi qui decroche
    ];
    const prefixes = extractObservations(answers).map((o) => o.prefixe);
    expect(prefixes).toContain(PREFIXE_CATEGORIE("admin"));
    expect(prefixes).toContain(PREFIXE_MOMENT);
  });

  it("les DEUX formulations du moment partagent le meme prefixe", () => {
    const matinTient = [
      ...Array.from({ length: 6 }, () => rep("x", 10, true)),
      ...Array.from({ length: 6 }, () => rep("x", 15, false)),
    ];
    const apremTient = [
      ...Array.from({ length: 6 }, () => rep("x", 10, false)),
      ...Array.from({ length: 6 }, () => rep("x", 15, true)),
    ];
    const a = extractObservations(matinTient).find((o) => o.prefixe === PREFIXE_MOMENT);
    const b = extractObservations(apremTient).find((o) => o.prefixe === PREFIXE_MOMENT);
    expect(a, "le cas matin doit produire une observation de moment").toBeDefined();
    expect(b, "le cas apres-midi doit produire une observation de moment").toBeDefined();
    expect(a!.contenu).not.toBe(b!.contenu);          // deux formulations differentes
    expect(a!.prefixe).toBe(b!.prefixe);              // MEME identite
    expect(a!.contenu.startsWith(a!.prefixe)).toBe(true);
    expect(b!.contenu.startsWith(b!.prefixe)).toBe(true);
  });

  it("est pure : deux appels sur les memes donnees rendent la meme chose", () => {
    const answers = Array.from({ length: 6 }, () => rep("admin", 10, false));
    expect(extractObservations(answers)).toEqual(extractObservations(answers));
  });

  it("une categorie SOUS MIN_OBSERVATIONS, dans une fenetre plus large, ne produit AUCUNE observation", () => {
    // Important 4, revue finale du 2026-09-16 : mutation "supprimer le garde
    // `if (e.total < MIN_OBSERVATIONS) continue;`" passait tous les tests
    // existants — aucune fixture n'avait de categorie sous le seuil (toutes en
    // avaient 6). "rare" est strictement sous MIN_OBSERVATIONS ; le reste de la
    // fenetre est de categorie INCONNUE (jamais citee) au MEME creneau horaire
    // (neutralise aussi la regle "moment" : aprem = 0).
    const rare = MIN_OBSERVATIONS - 2;
    const reste = MIN_OBSERVATIONS + 5;
    const answers = [
      ...Array.from({ length: rare }, () => rep("rare", 10, false)), // 0% de reussite : declencherait une observation SI le garde sautait
      ...Array.from({ length: reste }, () => rep(null, 10, true)),
    ];
    expect(extractObservations(answers)).toEqual([]);
  });
});

describe("prefixeDeContenu", () => {
  it("retrouve le prefixe d'une categorie QUELCONQUE, pas seulement celles produites aujourd'hui", () => {
    const contenu = `${PREFIXE_CATEGORIE("compta")} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.`;
    expect(prefixeDeContenu(contenu)).toBe(PREFIXE_CATEGORIE("compta"));
  });

  it("retrouve le prefixe du moment quelle que soit sa formulation", () => {
    expect(prefixeDeContenu(`${PREFIXE_MOMENT} ce qui est posé le matin se fait ; l'après-midi décroche.`)).toBe(PREFIXE_MOMENT);
    expect(prefixeDeContenu(`${PREFIXE_MOMENT} tes après-midis tiennent mieux que tes matinées.`)).toBe(PREFIXE_MOMENT);
  });

  it("rend null pour un contenu qui ne correspond a aucune regle connue", () => {
    expect(prefixeDeContenu("Une memoire d'un tout autre sujet, sans rapport.")).toBeNull();
  });

  it("est l'inverse exact de PREFIXE_CATEGORIE, pour toute observation produite par extractObservations", () => {
    const answers = Array.from({ length: 6 }, () => rep("admin", 10, false));
    const [obs] = extractObservations(answers);
    expect(prefixeDeContenu(obs.contenu)).toBe(obs.prefixe);
  });
});
