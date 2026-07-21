// Rail vertical de la séquence — le "plan view" stable de la campagne : un trait olive léger
// avec un nœud coloré par canal (channelMeta) pour chaque étape, et une SequenceStepCard à
// droite. C'est la pièce maîtresse visuelle de l'onglet Séquence (Task 5).
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { channelMeta } from './channels';
import SequenceStepCard from './SequenceStepCard';
import type { DraftSequenceStep } from './types';

interface SequenceTimelineProps {
  steps: DraftSequenceStep[];
  onChange: (index: number, partial: Partial<DraftSequenceStep>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onAdd: () => void;
  // Indices d'étapes invalides (ex. intention manquante) — undefined tant qu'aucune tentative
  // de save n'a eu lieu (voir SequenceTab.handleSave).
  invalidIndices?: Set<number>;
}

export default function SequenceTimeline({
  steps,
  onChange,
  onRemove,
  onMove,
  onAdd,
  invalidIndices,
}: SequenceTimelineProps) {
  return (
    <div className="max-w-2xl">
      {steps.length > 0 && (
        <div className="border-l-2 border-naya-olive-18 pl-6 space-y-5">
          {steps.map((step, index) => {
            const meta = channelMeta(step.channel);
            return (
              // Clé stable : `_key` (étapes pas encore persistées) ou `id` (étapes persistées) —
              // ne dépend jamais de `index` seul, sinon un réordonnancement remonte la carte et
              // fait perdre le focus des inputs.
              <div key={step._key ?? step.id ?? `draft-${index}`} className="relative">
                <span
                  className={`absolute -left-[1.875rem] top-4 w-3 h-3 rounded-full ring-4 ring-background ${meta.dot}`}
                  aria-hidden
                />
                <SequenceStepCard
                  step={step}
                  index={index}
                  total={steps.length}
                  onChange={onChange}
                  onRemove={onRemove}
                  onMove={onMove}
                  hasError={invalidIndices?.has(index) ?? false}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className={steps.length > 0 ? 'pl-6 mt-5' : ''}>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5" />
          Ajouter une étape
        </Button>
      </div>
    </div>
  );
}
