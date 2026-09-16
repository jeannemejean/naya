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

/**
 * Les chaînes littérales qu'une expression JSX peut AFFICHER.
 *
 * On descend dans le ternaire et dans `&&` / `||` parce que c'est la forme courante —
 * `{x ? 'Oui' : 'Non'}`, `{erreur && 'Échec'}` — et on s'arrête là. On ne descend
 * volontairement PAS dans les appels de fonction : `t('cle.x')` porte une chaîne littérale
 * qui est justement la traduction bien faite, et la signaler inverserait le sens de la garde.
 */
/**
 * `<style>` et `<script>` portent du code, jamais du texte lu par un humain. Sans cette
 * exclusion, un bloc `@keyframes` inséré via `<style>{...}</style>` serait signalé comme
 * une chaîne à traduire.
 */
function estBaliseTechnique(parent: ts.JsxElement | ts.JsxFragment): boolean {
  if (!ts.isJsxElement(parent)) return false;
  const nom = parent.openingElement.tagName.getText();
  return nom === "style" || nom === "script";
}

function litterauxAffiches(expr: ts.Expression | undefined): string[] {
  if (!expr) return [];
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr)) return litterauxAffiches(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    return [...litterauxAffiches(expr.whenTrue), ...litterauxAffiches(expr.whenFalse)];
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...litterauxAffiches(expr.left), ...litterauxAffiches(expr.right)];
    }
  }
  return [];
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
    trouves.push(...textesEnDurDansSource(chemin, readFileSync(fichier, "utf8")));
  }
  return trouves;
}

/** Même analyse, sur une source en mémoire. Rend le scan testable sans fichier sur disque. */
export function textesEnDurDansSource(chemin: string, source: string): TexteEnDur[] {
  const trouves: TexteEnDur[] = [];
  {
    const fichier = chemin;
    const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visiter = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const texte = node.text.trim();
        if (A_DU_TEXTE.test(texte)) trouves.push({ fichier: chemin, genre: "texte", texte });
      } else if (
        ts.isJsxExpression(node) &&
        node.parent &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
        !estBaliseTechnique(node.parent)
      ) {
        // Littéraux affichés depuis une expression : `{cond ? 'Update' : 'Add'}`, `{'Texte'}`.
        // Ce ne sont pas des noeuds JsxText, et une première version de ce scan les manquait
        // tous — la garde annoncait 912 occurrences en en ignorant une centaine.
        //
        // Le filtre sur le parent est ce qui rend la détection sûre : une expression enfant
        // d'un élément JSX est affichée, alors qu'une expression fille d'un JsxAttribute ne
        // l'est pas forcément — `className={a ? 'text-red' : 'text-blue'}` ne doit évidemment
        // pas être signalé.
        for (const litteral of litterauxAffiches(node.expression)) {
          if (A_DU_TEXTE.test(litteral)) {
            trouves.push({ fichier: chemin, genre: "expression", texte: litteral });
          }
        }
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
