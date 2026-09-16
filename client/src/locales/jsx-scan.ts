import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Compte les chaînes de texte écrites EN DUR dans le JSX, par fichier.
 *
 * Utilisé par `jsx-guard.test.ts`. Un texte en dur est du texte que `t()` ne traduit pas :
 * il reste dans sa langue d'écriture quelle que soit la langue choisie, ce qui produit les
 * pages mi-françaises mi-anglaises constatées sur `settings` et `brand-dna-editor`.
 *
 * L'analyse passe par le parseur TypeScript, pas par une expression régulière. Une première
 * version cherchait le texte entre `>` et `<` : elle comptait aussi les opérateurs de
 * comparaison et les génériques — `useState<Foo>(null)` devenait du « texte visible » — et
 * surestimait le total de près de 300 occurrences.
 */

/** Au moins deux lettres consécutives : exclut la ponctuation, les nombres, les symboles. */
const A_DU_TEXTE = /[A-Za-zÀ-ÿ]{2,}/;

/** Attributs dont la valeur est lue par un humain. */
const ATTRIBUTS_VISIBLES = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "description",
]);

export interface TexteEnDur {
  fichier: string;
  genre: string;
  texte: string;
}

export function fichiersTsx(racine: string): string[] {
  const trouves: string[] = [];
  const descendre = (chemin: string) => {
    for (const entree of readdirSync(chemin, { withFileTypes: true })) {
      const complet = join(chemin, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === "node_modules" || entree.name === "dist") continue;
        descendre(complet);
      } else if (/\.tsx$/.test(entree.name) && !/\.test\.tsx$/.test(entree.name)) {
        trouves.push(complet);
      }
    }
  };
  // Un dossier illisible doit faire TOMBER l'appelant, jamais renvoyer une liste vide :
  // une garde qui ne trouve plus ses fichiers passerait au vert en ne gardant rien.
  statSync(racine);
  descendre(racine);
  return trouves;
}

export function textesEnDur(racineProjet: string, dossier: string): TexteEnDur[] {
  const trouves: TexteEnDur[] = [];

  for (const fichier of fichiersTsx(join(racineProjet, dossier))) {
    const chemin = relative(racineProjet, fichier).split("\\").join("/");
    const source = readFileSync(fichier, "utf8");
    const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visiter = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const texte = node.text.trim();
        if (A_DU_TEXTE.test(texte)) trouves.push({ fichier: chemin, genre: "texte", texte });
      } else if (ts.isJsxAttribute(node) && node.initializer) {
        const nom = node.name.getText(sf);
        if (ATTRIBUTS_VISIBLES.has(nom)) {
          const init = node.initializer;
          const litteral = ts.isStringLiteral(init)
            ? init.text
            : ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)
              ? init.expression.text
              : null;
          if (litteral && A_DU_TEXTE.test(litteral)) {
            trouves.push({ fichier: chemin, genre: `attr:${nom}`, texte: litteral });
          }
        }
      }
      ts.forEachChild(node, visiter);
    };
    visiter(sf);
  }

  return trouves;
}

export function compterParFichier(textes: TexteEnDur[]): Record<string, number> {
  const parFichier: Record<string, number> = {};
  for (const t of textes) parFichier[t.fichier] = (parFichier[t.fichier] ?? 0) + 1;
  return parFichier;
}
