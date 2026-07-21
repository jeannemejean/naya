// Primitive de MISE EN PAGE de l'arbre de séquence — tronc, fourches, branches seules et
// connecteurs SVG — partagée entre l'onglet Séquence (cartes éditables) et l'onglet Aperçu
// (cartes de message en lecture seule). Seul le CONTENU de chaque nœud diffère : le layout ne
// sait pas ce qu'une carte affiche, il appelle `renderNode`. La dérivation tronc/fourche/branche
// vit dans SequenceTree.logic.ts (pure, testée) ; ici c'est uniquement le rendu visuel.
import { useMemo, type ReactNode } from 'react';
import { Check, X, type LucideIcon } from 'lucide-react';
import { channelMeta } from './channels';
import {
  buildBranches,
  type Affordance,
  type BranchNode,
  type IndexedStep,
  type TreeSegment,
  type TreeStep,
} from './SequenceTree.logic';

const AFFORDANCE_META: Record<Affordance, { Icon: LucideIcon; text: string }> = {
  positive: { Icon: Check, text: 'text-naya-olive-70' },
  negative: { Icon: X, text: 'text-naya-mauve' },
};

// Label d'une branche : pastille de canal + icône ✓/✗ + libellé de condition (« si invitation
// acceptée »…). Posé au-dessus de la carte, il rend la condition lisible sans que la carte ait à
// répéter un badge.
function BranchLabel<T extends TreeStep>({ node }: { node: BranchNode<T> }) {
  const { Icon, text } = AFFORDANCE_META[node.affordance];
  const meta = channelMeta(node.step.channel);
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} aria-hidden />
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${text}`}>
        <Icon className="w-3 h-3 flex-shrink-0" />
        {node.label}
      </span>
    </div>
  );
}

// Connecteur d'une branche seule (condition sans complément adjacent) : un trait qui descend
// du tronc puis part en diagonale vers la carte.
function StubConnector() {
  return (
    <svg width="24" height="36" viewBox="0 0 24 36" className="flex-shrink-0 text-naya-olive-35" aria-hidden>
      <path d="M 1 0 V 10 Q 1 18 10 18 H 24" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Connecteur de fourche : un trait vertical central qui se scinde en deux bras horizontaux, un
// par branche complémentaire.
function ForkConnector() {
  return (
    <svg viewBox="0 0 200 32" preserveAspectRatio="none" className="w-full h-8 text-naya-olive-35" aria-hidden>
      <line x1="100" y1="0" x2="100" y2="16" stroke="currentColor" strokeWidth="2" />
      <path d="M 25 16 H 175" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="25" y1="16" x2="25" y2="32" stroke="currentColor" strokeWidth="2" />
      <line x1="175" y1="16" x2="175" y2="32" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Connecteur de fusion : les deux bras d'une fourche se rejoignent en un seul trait — reconnecte
// visuellement au tronc quand la séquence continue après une fourche.
function MergeConnector() {
  return (
    <svg viewBox="0 0 200 32" preserveAspectRatio="none" className="w-full h-8 text-naya-olive-35" aria-hidden>
      <line x1="25" y1="0" x2="25" y2="16" stroke="currentColor" strokeWidth="2" />
      <line x1="175" y1="0" x2="175" y2="16" stroke="currentColor" strokeWidth="2" />
      <path d="M 25 16 H 175" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="100" y1="16" x2="100" y2="32" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Contexte passé à `renderNode` : de quel type de segment le nœud provient. Le consommateur s'en
// sert pour ajuster son rendu (ex. masquer le badge de condition dans une branche/fourche, déjà
// couvert par le BranchLabel au-dessus).
export type TreeNodeContext = 'trunk' | 'fork' | 'branch';

export type TreeNodeRenderer<T extends TreeStep> = (
  node: IndexedStep<T>,
  segment: TreeNodeContext,
) => ReactNode;

interface SequenceTreeLayoutProps<T extends TreeStep> {
  steps: T[];
  renderNode: TreeNodeRenderer<T>;
  // Clé React stable par nœud — permet à l'onglet Séquence de conserver le focus des inputs à
  // travers un réordonnancement (via `_key`). Par défaut : l'index d'origine du step.
  nodeKey?: (node: IndexedStep<T>) => string | number;
}

function segmentKey<T extends TreeStep>(segment: TreeSegment<T>): string {
  if (segment.kind === 'trunk') return `trunk-${segment.nodes[0]?.index ?? 'empty'}`;
  if (segment.kind === 'fork') return `fork-${segment.positive.index}-${segment.negative.index}`;
  return `branch-${segment.node.index}`;
}

// Rend l'arbre (tronc + fourches + branches + connecteurs). Le CONTENU de chaque carte est
// délégué à `renderNode`. Ne rend rien si la liste est vide — l'appelant gère l'état vide et
// enveloppe (max-w, en-tête, CTA…).
export default function SequenceTreeLayout<T extends TreeStep>({
  steps,
  renderNode,
  nodeKey,
}: SequenceTreeLayoutProps<T>) {
  const segments = useMemo(() => buildBranches(steps), [steps]);
  const keyOf = (node: IndexedStep<T>) => nodeKey?.(node) ?? node.index;

  if (segments.length === 0) return null;

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        // Une fourche suivie d'un autre segment doit se reconnecter visuellement au tronc —
        // sauf si c'est la dernière (rien à reconnecter en dessous).
        const showMerge = segment.kind === 'fork' && i < segments.length - 1;
        return (
          <div key={segmentKey(segment)}>
            {segment.kind === 'trunk' && (
              <div className="border-l-2 border-naya-olive-18 pl-6 space-y-5">
                {segment.nodes.map((node) => {
                  const meta = channelMeta(node.step.channel);
                  return (
                    <div key={keyOf(node)} className="relative">
                      <span
                        className={`absolute -left-[1.875rem] top-4 w-3 h-3 rounded-full ring-4 ring-background ${meta.dot}`}
                        aria-hidden
                      />
                      {renderNode(node, 'trunk')}
                    </div>
                  );
                })}
              </div>
            )}

            {segment.kind === 'branch' && (
              <div className="flex items-start gap-1">
                <StubConnector />
                <div className="flex-1 min-w-0 space-y-1.5 pt-2.5">
                  <BranchLabel node={segment.node} />
                  {renderNode(segment.node, 'branch')}
                </div>
              </div>
            )}

            {segment.kind === 'fork' && (
              <div className="space-y-2">
                <ForkConnector />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[segment.positive, segment.negative].map((node) => (
                    <div key={keyOf(node)} className="space-y-1.5 min-w-0">
                      <BranchLabel node={node} />
                      {renderNode(node, 'fork')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showMerge && <MergeConnector />}
          </div>
        );
      })}
    </div>
  );
}
