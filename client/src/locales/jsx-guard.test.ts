import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { textesEnDur, compterParFichier, fichiersTsx } from "./jsx-scan";
import baseline from "./jsx-baseline.json";

/**
 * Garde à cliquet sur les textes écrits en dur dans le JSX.
 *
 * Le problème : 912 chaînes ne passent pas par `t()`. Elles restent dans leur langue
 * d'écriture quelle que soit la langue choisie, d'où les pages mélangées — `settings.tsx`
 * porte 20 chaînes anglaises et 25 françaises dans le même écran, `brand-dna-editor.tsx`
 * est écrit presque entièrement en anglais.
 *
 * Tout corriger d'un coup ferait un diff irrelisable. Ce cliquet rend la situation
 * strictement non aggravable dès maintenant, et force la décrue :
 *
 *   - un fichier qui DÉPASSE sa référence fait tomber le test ;
 *   - un fichier ABSENT de la référence ne doit porter aucun texte en dur ;
 *   - un fichier qui PASSE SOUS sa référence fait aussi tomber le test, avec la nouvelle
 *     valeur à inscrire. Sans cette troisième règle, la marge gagnée se laisserait
 *     reprendre en silence et la référence ne descendrait jamais.
 *
 * Pour mettre à jour après correction :
 *   npx tsx -e "import {textesEnDur,compterParFichier} from './client/src/locales/jsx-scan';
 *   import {writeFileSync} from 'node:fs';
 *   const c=compterParFichier(textesEnDur(process.cwd(),'client/src'));
 *   writeFileSync('client/src/locales/jsx-baseline.json',
 *     JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n')"
 */

const RACINE = join(import.meta.dirname ?? __dirname, "..", "..", "..");
const REFERENCE = baseline as Record<string, number>;

describe("textes en dur dans le JSX — cliquet", () => {
  it("scanne réellement des fichiers", () => {
    // Sans ça, une erreur de chemin rendrait toute la garde verte en ne trouvant rien.
    expect(fichiersTsx(join(RACINE, "client/src")).length).toBeGreaterThan(50);
  });

  it("la référence n'est pas vide", () => {
    expect(Object.keys(REFERENCE).length).toBeGreaterThan(0);
  });

  it("aucun fichier ne dépasse sa référence, et aucun nouveau fichier n'en introduit", () => {
    const actuel = compterParFichier(textesEnDur(RACINE, "client/src"));
    const regressions: string[] = [];

    for (const [fichier, n] of Object.entries(actuel)) {
      const ref = REFERENCE[fichier] ?? 0;
      if (n > ref) {
        regressions.push(
          ref === 0
            ? `${fichier} — ${n} texte(s) en dur dans un fichier qui n'en avait aucun. Utilise t().`
            : `${fichier} — ${n} textes en dur, la référence est ${ref}. Utilise t().`,
        );
      }
    }

    expect(regressions, `\n${regressions.join("\n")}\n`).toEqual([]);
  });

  it("la référence est à jour : aucun fichier n'est passé sous sa valeur sans qu'on l'abaisse", () => {
    const actuel = compterParFichier(textesEnDur(RACINE, "client/src"));
    const aAbaisser: string[] = [];

    for (const [fichier, ref] of Object.entries(REFERENCE)) {
      const n = actuel[fichier] ?? 0;
      if (n < ref) {
        aAbaisser.push(
          n === 0
            ? `${fichier} — plus aucun texte en dur : retire la ligne de jsx-baseline.json.`
            : `${fichier} — ${n} désormais, la référence dit encore ${ref} : abaisse-la à ${n}.`,
        );
      }
    }

    expect(aAbaisser, `\n${aAbaisser.join("\n")}\n`).toEqual([]);
  });
});
