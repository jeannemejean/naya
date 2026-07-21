// Une étape du plan de séquence — carte éditable (canal, délai, intention, condition de
// branchement) rendue dans SequenceTimeline. Ne montre jamais le texte du message (c'est le
// rôle de l'onglet Aperçu, Task 6) : ici, c'est le PLAN, pas le message.
import { ArrowDown, ArrowUp, Clock, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { channelMeta } from './channels';
import { CONDITION_LABELS, type DraftSequenceStep } from './types';

interface SequenceStepCardProps {
  step: DraftSequenceStep;
  index: number;
  total: number;
  onChange: (index: number, partial: Partial<DraftSequenceStep>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  // Intention manquante détectée à la dernière tentative de save — affiche un indice discret
  // (bordure) sans bloquer la saisie.
  hasError?: boolean;
  // SequenceTree affiche déjà la condition sous forme de label de branche (✓/✗) au-dessus de la
  // carte — passer false évite un badge de condition redondant. Le tronc (condition "always") ne
  // montre de toute façon jamais ce badge, donc la valeur par défaut reste correcte partout.
  showConditionBadge?: boolean;
}

const FIELD_LABEL = 'text-[10px] font-medium uppercase tracking-wide text-naya-olive-55';

export default function SequenceStepCard({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMove,
  hasError = false,
  showConditionBadge = true,
}: SequenceStepCardProps) {
  const meta = channelMeta(step.channel);
  const Icon = meta.Icon;

  return (
    <Card className={`p-4 flex flex-col gap-3 overflow-hidden ${hasError ? 'border-naya-mauve' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
          <span className="text-xs text-naya-olive-55">Étape {index + 1}</span>
          {showConditionBadge && step.condition !== 'always' && (
            <Badge variant="outline">{CONDITION_LABELS[step.condition] ?? step.condition}</Badge>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            aria-label="Déplacer l'étape vers le haut"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            aria-label="Déplacer l'étape vers le bas"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-naya-mauve"
            onClick={() => onRemove(index)}
            aria-label="Supprimer l'étape"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Champs empilés verticalement : layout unique qui tient aussi bien en pleine largeur (tronc)
          que dans une colonne étroite de fourche (deux cartes côte à côte) — voir SequenceTree.tsx.
          `min-w-0` sur chaque conteneur laisse le texte/les contrôles se rétrécir plutôt que forcer
          un débordement hors de la carte. */}
      <div className="flex flex-col gap-3 min-w-0">
        <div className="space-y-1 min-w-0">
          <span className={FIELD_LABEL}>Canal</span>
          <Select value={step.channel} onValueChange={(v) => onChange(index, { channel: v })}>
            <SelectTrigger className="h-9 text-sm w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 min-w-0">
          <span className={FIELD_LABEL}>Délai</span>
          <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-sm border border-naya-olive-18 focus-within:ring-1 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background focus-within:border-naya-olive min-w-0">
            <Clock className="w-3.5 h-3.5 text-naya-olive-55 flex-shrink-0" />
            <span className="text-sm text-naya-olive-70 flex-shrink-0">J+</span>
            <Input
              type="number"
              min={0}
              value={step.delayDays}
              onChange={(e) => onChange(index, { delayDays: Math.max(0, Number(e.target.value) || 0) })}
              className="h-auto w-full min-w-0 border-0 p-0 bg-transparent text-sm text-foreground hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Délai en jours après l'étape précédente"
            />
          </div>
        </div>

        <div className="space-y-1 min-w-0">
          <span className={FIELD_LABEL}>Intention</span>
          <Input
            value={step.intention}
            onChange={(e) => onChange(index, { intention: e.target.value })}
            placeholder="Ex. Présenter l'offre, relancer si pas de réponse…"
            className={`h-9 text-sm w-full ${hasError ? 'border-naya-mauve' : ''}`}
            aria-invalid={hasError}
          />
          {hasError && <p className="text-xs text-naya-mauve">L'intention est requise.</p>}
        </div>

        <div className="space-y-1 min-w-0">
          <span className={FIELD_LABEL}>Condition d'envoi</span>
          <Select value={step.condition} onValueChange={(v) => onChange(index, { condition: v })}>
            <SelectTrigger className="h-8 w-fit max-w-full text-xs px-2.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}
