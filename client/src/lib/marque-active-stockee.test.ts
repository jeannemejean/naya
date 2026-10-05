import { describe, it, expect } from "vitest";
import {
  CLE_MARQUE_ACTIVE,
  lireMarqueStockee,
  oublierMarqueStockee,
} from "./marque-active-stockee";

/** Faux stockage : node n'a pas de `localStorage`, et on veut pouvoir le casser. */
function faireStockage(valeur: string | null, options: { casse?: boolean } = {}) {
  const etat: Record<string, string | null> = { [CLE_MARQUE_ACTIVE]: valeur };
  return {
    etat,
    getItem(cle: string) {
      if (options.casse) throw new Error("localStorage inaccessible");
      return etat[cle] ?? null;
    },
    removeItem(cle: string) {
      if (options.casse) throw new Error("localStorage inaccessible");
      etat[cle] = null;
    },
  };
}

describe("lireMarqueStockee", () => {
  it("lit un identifiant valide", () => {
    expect(lireMarqueStockee(faireStockage("42"))).toBe(42);
  });

  it("tolère les espaces autour", () => {
    expect(lireMarqueStockee(faireStockage("  42  "))).toBe(42);
  });

  it("rend null quand rien n'est stocké", () => {
    expect(lireMarqueStockee(faireStockage(null))).toBeNull();
    expect(lireMarqueStockee(faireStockage(""))).toBeNull();
  });

  it("rend null sur une valeur NON NUMÉRIQUE au lieu de propager NaN", () => {
    // Le défaut d'origine : `stored ? parseInt(stored) : null` rendait NaN, qui partait
    // dans les requêtes (`projectId=NaN`) et faisait répondre 400 au serveur.
    for (const sale of ["abc", "null", "undefined", "12abc", "NaN", "{}"]) {
      expect(lireMarqueStockee(faireStockage(sale))).toBeNull();
    }
  });

  it("rend null sur zéro et sur un négatif — un identifiant de marque est positif", () => {
    expect(lireMarqueStockee(faireStockage("0"))).toBeNull();
    expect(lireMarqueStockee(faireStockage("-3"))).toBeNull();
  });

  it("rend null sur un nombre décimal", () => {
    expect(lireMarqueStockee(faireStockage("4.2"))).toBeNull();
  });

  it("rend null plutôt que de lever quand le stockage est inaccessible", () => {
    // Navigation privée, réglage du navigateur : une lecture peut jeter. Le premier
    // rendu ne doit pas en mourir.
    expect(lireMarqueStockee(faireStockage("42", { casse: true }))).toBeNull();
  });
});

describe("oublierMarqueStockee", () => {
  it("efface l'identifiant", () => {
    const s = faireStockage("42");
    oublierMarqueStockee(s);
    expect(lireMarqueStockee(s)).toBeNull();
  });

  it("est sans effet quand il n'y a rien à effacer", () => {
    const s = faireStockage(null);
    expect(() => oublierMarqueStockee(s)).not.toThrow();
    expect(lireMarqueStockee(s)).toBeNull();
  });

  it("ne lève JAMAIS, même si le stockage est inaccessible", () => {
    // Appelé depuis un gestionnaire d'erreur et depuis la réinitialisation : s'il
    // levait, il ferait échouer la récupération qu'il est censé servir.
    const s = faireStockage("42", { casse: true });
    expect(() => oublierMarqueStockee(s)).not.toThrow();
  });
});

describe("la clé", () => {
  it("est celle que le reste de l'application utilise déjà", () => {
    // Un renommage silencieux laisserait l'ancienne clé en place dans les navigateurs
    // existants, et la boucle du 5 octobre deviendrait irrécupérable pour eux.
    expect(CLE_MARQUE_ACTIVE).toBe("naya_active_project_id");
  });
});
