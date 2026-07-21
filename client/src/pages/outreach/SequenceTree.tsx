// Arbre de décision de la séquence — dérivation VISUELLE d'une liste plate de steps portant
// chacune une condition (le backend reste "conditions sur les steps", jamais un graphe stocké,
// voir types.ts / server/routes.ts). Remplace SequenceTimeline (rail linéaire) : quand deux
// conditions adjacentes sont complémentaires (ex. if_invite_accepted / if_invite_not_accepted),
// elles se lisent bien mieux comme une FOURCHE à deux branches labellisées que comme deux nœuds
// empilés sur un même trait. Le tronc (condition "always") garde le rail vertical d'origine.
//
// Le rendu tronc/fourche/connecteurs vit dans SequenceTreeLayout (partagé avec l'onglet Aperçu) ;
// ce composant n'apporte que le CONTENU d'un nœud : la carte éditable SequenceStepCard.
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SequenceStepCard from './SequenceStepCard';
import SequenceTreeLayout, { type TreeNodeRenderer } from './SequenceTreeLayout';
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

export default function SequenceTree({ steps, onChange, onRemove, onMove, onAdd, invalidIndices }: SequenceTreeProps) {
  const total = steps.length;

  // Chaque nœud rend la carte éditable. Le tronc ne contient que des étapes "always" (pas de
  // badge de condition de toute façon) ; dans une branche/fourche le BranchLabel du layout affiche
  // déjà la condition, donc on masque le badge redondant.
  const renderNode: TreeNodeRenderer<DraftSequenceStep> = (node, segment) => (
    <SequenceStepCard
      step={node.step}
      index={node.index}
      total={total}
      onChange={onChange}
      onRemove={onRemove}
      onMove={onMove}
      hasError={invalidIndices?.has(node.index) ?? false}
      showConditionBadge={segment === 'trunk'}
    />
  );

  return (
    <div className="max-w-2xl">
      <SequenceTreeLayout steps={steps} renderNode={renderNode} nodeKey={(node) => stepKey(node.step, node.index)} />

      <div className={total > 0 ? 'mt-5' : ''}>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5" />
          Ajouter une étape
        </Button>
      </div>
    </div>
  );
}
