import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fr from "./fr";
import en from "./en";
import { fichiersTsx } from "./jsx-scan";

/**
 * Toute clé passée à `t()` doit exister dans LES DEUX dictionnaires.
 *
 * Pourquoi ce test compte ici. `client/src/lib/i18n.ts` configure `fallbackLng: false`,
 * délibérément — « pas de repli d'une langue vers l'autre : une clé manquante doit se VOIR ».
 * Elle se voit, en effet : i18next affiche alors la clé brute. Une faute de frappe met donc
 * « brandDna.pillarName » à l'écran, à la place du libellé.
 *
 * `locales.test.ts` garantit que les deux dictionnaires portent les mêmes clés. Il ne dit
 * rien de celles que le code appelle réellement : deux dictionnaires peuvent être
 * parfaitement symétriques et ne contenir aucune des clés utilisées.
 *
 * Les 158 clés de brand-dna-editor ayant été produites par un codemod, une clé fabriquée
 * d'un côté et écrite autrement de l'autre était l'erreur la plus probable du lot.
 */

const RACINE = join(import.meta.dirname ?? __dirname, "..", "..", "..");

/** `t('a.b.c')` — on ne retient que les appels à clé littérale, les seuls vérifiables. */
const APPEL_T = /\bt\(\s*['"]([A-Za-z0-9_][A-Za-z0-9_.]*)['"]\s*[,)]/g;

function resoudre(dictionnaire: unknown, cle: string): unknown {
  return cle.split(".").reduce<any>((o, p) => (o == null ? undefined : o[p]), dictionnaire);
}

function clesUtilisees(): Map<string, string[]> {
  const parCle = new Map<string, string[]>();
  for (const fichier of fichiersTsx(join(RACINE, "client/src"))) {
    const chemin = relative(RACINE, fichier).split("\\").join("/");
    const source = readFileSync(fichier, "utf8");
    for (const m of source.matchAll(APPEL_T)) {
      const cle = m[1];
      // Une clé sans point n'en est pas une : c'est un appel à autre chose que i18next
      // (`filter(t => ...)`, `map(t => t.id)`), ou un texte passé tel quel.
      if (!cle.includes(".")) continue;
      if (!parCle.has(cle)) parCle.set(cle, []);
      parCle.get(cle)!.push(chemin);
    }
  }
  return parCle;
}

describe("toute clé t() existe dans les deux dictionnaires", () => {
  it("le relevé trouve des clés", () => {
    // Sans ça, une expression cassée rendrait le test suivant vert en ne relevant rien.
    expect(clesUtilisees().size).toBeGreaterThan(100);
  });

  it("aucune clé utilisée ne manque au français", () => {
    const manquantes: string[] = [];
    for (const [cle, fichiers] of clesUtilisees()) {
      if (typeof resoudre(fr, cle) !== "string") manquantes.push(`${cle} — ${fichiers[0]}`);
    }
    expect(manquantes, `\n${manquantes.join("\n")}\n`).toEqual([]);
  });

  it("aucune clé utilisée ne manque à l'anglais", () => {
    const manquantes: string[] = [];
    for (const [cle, fichiers] of clesUtilisees()) {
      if (typeof resoudre(en, cle) !== "string") manquantes.push(`${cle} — ${fichiers[0]}`);
    }
    expect(manquantes, `\n${manquantes.join("\n")}\n`).toEqual([]);
  });
});
