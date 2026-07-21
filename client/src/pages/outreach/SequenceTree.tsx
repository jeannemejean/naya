// Arbre de décision de la séquence — dérivation VISUELLE d'une liste plate de steps portant
// chacune une condition (le backend reste "conditions sur les steps", jamais un graphe stocké,
// voir types.ts / server/routes.ts). Remplace SequenceTimeline (rail linéaire) : quand deux
// conditions adjacentes sont complémentaires (ex. if_invite_accepted / if_invite_not_accepted),
// elles se lisent bien mieux comme une FOURCHE à deux branches labellisées que comme deux nœuds
// empilés sur un même trait. Le tronc (condition "always") garde le rail vertical d'origine.
import { useMemo } from 'react';
import { Check, Plus, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { channelMeta } from './channels';
import SequenceStepCard from './SequenceStepCard';
import { buildBranches, type Affordance, type BranchNode, type IndexedStep, type TreeSegment } from './SequenceTree.logic';
import type { DraftSequenceStep } from './types';

// Le cœur pur (dérivation tronc/fourches/branches) vit dans SequenceTree.logic.ts, sans JSX, pour
// rester importable tel quel par vitest — voir SequenceTree.test.ts et le commentaire d'en-tête de
// ce module frère.
export { buildBranches, type TreeSegment } from './SequenceTree.logic';

interface SequenceTreeProps {
  steps: DraftSequenceStep[];
  onChange: (index: number, partial: Partial<DraftSequenceStep>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onAdd: () => void;
  // Indices d'étapes invalides (ex. intention manquante) — undefined tant qu'aucune tentative
  // de save n'a eu lieu (voir SequenceTab.handleSave).
  invalidIndices?: Set<number>;
}

function stepKey(step: DraftSequenceStep, index: number) {
  return step._key ?? step.id ?? `draft-${index}`;
}

const AFFORDANCE_META: Record<Affordance, { Icon: LucideIcon; text: string }> = {
  positive: { Icon: Check, text: 'text-naya-olive-70' },
  negative: { Icon: X, text: 'text-naya-mauve' },
};

function BranchLabel({ node }: { node: BranchNode }) {
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

interface SharedHandlers {
  total: number;
  onChange: (index: number, partial: Partial<DraftSequenceStep>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  invalidIndices?: Set<number>;
}

function TrunkSegment({ nodes, total, onChange, onRemove, onMove, invalidIndices }: SharedHandlers & { nodes: IndexedStep[] }) {
  return (
    <div className="border-l-2 border-naya-olive-18 pl-6 space-y-5">
      {nodes.map(({ step, index }) => {
        const meta = channelMeta(step.channel);
        return (
          <div key={stepKey(step, index)} className="relative">
            <span
              className={`absolute -left-[1.875rem] top-4 w-3 h-3 rounded-full ring-4 ring-background ${meta.dot}`}
              aria-hidden
            />
            <SequenceStepCard
              step={step}
              index={index}
              total={total}
              onChange={onChange}
              onRemove={onRemove}
              onMove={onMove}
              hasError={invalidIndices?.has(index) ?? false}
            />
          </div>
        );
      })}
    </div>
  );
}

function BranchSegment({ node, total, onChange, onRemove, onMove, invalidIndices }: SharedHandlers & { node: BranchNode }) {
  return (
    <div className="flex items-start gap-1">
      <StubConnector />
      <div className="flex-1 min-w-0 space-y-1.5 pt-2.5">
        <BranchLabel node={node} />
        <SequenceStepCard
          step={node.step}
          index={node.index}
          total={total}
          onChange={onChange}
          onRemove={onRemove}
          onMove={onMove}
          hasError={invalidIndices?.has(node.index) ?? false}
          showConditionBadge={false}
        />
      </div>
    </div>
  );
}

function ForkSegment({
  positive,
  negative,
  total,
  onChange,
  onRemove,
  onMove,
  invalidIndices,
}: SharedHandlers & { positive: BranchNode; negative: BranchNode }) {
  return (
    <div className="space-y-2">
      <ForkConnector />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[positive, negative].map((node) => (
          <div key={stepKey(node.step, node.index)} className="space-y-1.5">
            <BranchLabel node={node} />
            <SequenceStepCard
              step={node.step}
              index={node.index}
              total={total}
              onChange={onChange}
              onRemove={onRemove}
              onMove={onMove}
              hasError={invalidIndices?.has(node.index) ?? false}
              showConditionBadge={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function segmentKey(segment: TreeSegment): string {
  if (segment.kind === 'trunk') return `trunk-${segment.nodes[0]?.index ?? 'empty'}`;
  if (segment.kind === 'fork') return `fork-${segment.positive.index}-${segment.negative.index}`;
  return `branch-${segment.node.index}`;
}

export default function SequenceTree({ steps, onChange, onRemove, onMove, onAdd, invalidIndices }: SequenceTreeProps) {
  const segments = useMemo(() => buildBranches(steps), [steps]);
  const total = steps.length;
  const shared: SharedHandlers = { total, onChange, onRemove, onMove, invalidIndices };

  return (
    <div className="max-w-2xl">
      {segments.length > 0 && (
        <div className="space-y-4">
          {segments.map((segment, i) => {
            // Une fourche suivie d'un autre segment doit se reconnecter visuellement au tronc —
            // sauf si c'est la dernière (rien à reconnecter en dessous).
            const showMerge = segment.kind === 'fork' && i < segments.length - 1;
            return (
              <div key={segmentKey(segment)}>
                {segment.kind === 'trunk' && <TrunkSegment nodes={segment.nodes} {...shared} />}
                {segment.kind === 'branch' && <BranchSegment node={segment.node} {...shared} />}
                {segment.kind === 'fork' && (
                  <ForkSegment positive={segment.positive} negative={segment.negative} {...shared} />
                )}
                {showMerge && <MergeConnector />}
              </div>
            );
          })}
        </div>
      )}

      <div className={segments.length > 0 ? 'mt-5' : ''}>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5" />
          Ajouter une étape
        </Button>
      </div>
    </div>
  );
}
