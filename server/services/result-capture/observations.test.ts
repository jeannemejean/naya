import { describe, it, expect } from "vitest";
import { extractObservations, PREFIXE_CATEGORIE, PREFIXE_MOMENT } from "./observations";
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
});
