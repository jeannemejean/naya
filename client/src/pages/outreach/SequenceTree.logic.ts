// Dérivation pure (tronc / fourches / branches) de la liste plate de steps conditionnelles d'une
// séquence — le cœur testable de SequenceTree.tsx. Volontairement séparé du composant React : ce
// fichier ne contient aucun JSX, donc reste transformable tel quel par vitest (vitest.config.ts
// n'inclut pas @vitejs/plugin-react, et tsconfig.json a "jsx": "preserve" — cf. le même choix dans
// client/src/components/ErrorBoundary.tsx).
import { CONDITION_LABELS, type DraftSequenceStep } from './types';

export type Affordance = 'positive' | 'negative';

// Le dérivateur ne lit que `channel` (pour la pastille de canal) et `condition` (pour la
// polarité) — il est donc générique sur toute forme d'étape portant ces deux champs. Cela permet
// à l'onglet Aperçu de faire passer ses `PreviewStep` (qui ajoutent subject/body/error) dans le
// même arbre que les `DraftSequenceStep` éditables de l'onglet Séquence, sans copier la logique.
export type TreeStep = { channel: string; condition: string };

export type IndexedStep<T extends TreeStep = DraftSequenceStep> = { step: T; index: number };
export type BranchNode<T extends TreeStep = DraftSequenceStep> = IndexedStep<T> & {
  label: string;
  affordance: Affordance;
};

export type TreeSegment<T extends TreeStep = DraftSequenceStep> =
  | { kind: 'trunk'; nodes: IndexedStep<T>[] }
  | { kind: 'fork'; positive: BranchNode<T>; negative: BranchNode<T> }
  | { kind: 'branch'; node: BranchNode<T> };

// Groupe "opposition" d'une condition — deux steps adjacents du même groupe et de signe différent
// forment une fourche. `if_clicked` est traité comme le pendant positif de `if_not_opened`, au
// même titre que `if_opened` (cf. consigne produit : "treat if_clicked similarly to if_opened's
// positive side").
export function polarity(condition: string): { group: 'invite' | 'email'; sign: Affordance } | null {
  switch (condition) {
    case 'if_invite_accepted':
      return { group: 'invite', sign: 'positive' };
    case 'if_invite_not_accepted':
      return { group: 'invite', sign: 'negative' };
    case 'if_opened':
    case 'if_clicked':
      return { group: 'email', sign: 'positive' };
    case 'if_not_opened':
      return { group: 'email', sign: 'negative' };
    default:
      return null;
  }
}

function toBranchNode<T extends TreeStep>({ step, index }: IndexedStep<T>): BranchNode<T> {
  const pol = polarity(step.condition);
  return {
    step,
    index,
    label: CONDITION_LABELS[step.condition] ?? step.condition,
    // Une condition sans polarité connue (ne devrait pas arriver hors "always", déjà traité en
    // amont) s'affiche par défaut comme une branche positive plutôt que de planter le rendu.
    affordance: pol?.sign ?? 'positive',
  };
}

// Cœur testable et pur : dérive la structure d'arbre — tronc / fourches / branches seules — de la
// liste plate `steps`. Voir SequenceTree.test.ts.
export function buildBranches<T extends TreeStep>(steps: T[]): TreeSegment<T>[] {
  const segments: TreeSegment<T>[] = [];
  let trunkRun: IndexedStep<T>[] = [];

  const flushTrunk = () => {
    if (trunkRun.length > 0) {
      segments.push({ kind: 'trunk', nodes: trunkRun });
      trunkRun = [];
    }
  };

  let i = 0;
  while (i < steps.length) {
    const step = steps[i];

    if (step.condition === 'always') {
      trunkRun.push({ step, index: i });
      i += 1;
      continue;
    }

    const pol = polarity(step.condition);
    const next = steps[i + 1];
    const nextPol = next ? polarity(next.condition) : null;
    const isComplementaryPair =
      !!pol && !!nextPol && pol.group === nextPol.group && pol.sign !== nextPol.sign;

    flushTrunk();

    if (isComplementaryPair && next) {
      const a = toBranchNode({ step, index: i });
      const b = toBranchNode({ step: next, index: i + 1 });
      segments.push({
        kind: 'fork',
        positive: a.affordance === 'positive' ? a : b,
        negative: a.affordance === 'negative' ? a : b,
      });
      i += 2;
    } else {
      segments.push({ kind: 'branch', node: toBranchNode({ step, index: i }) });
      i += 1;
    }
  }
  flushTrunk();

  return segments;
}
