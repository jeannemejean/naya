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
}

const FIELD_LABEL = 'text-[10px] font-medium uppercase tracking-wide text-naya-olive-55';

export default function SequenceStepCard({ step, index, total, onChange, onRemove, onMove }: SequenceStepCardProps) {
  const meta = channelMeta(step.channel);
  const Icon = meta.Icon;

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
          <span className="text-xs text-naya-olive-55">Étape {index + 1}</span>
          {step.condition !== 'always' && (
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

      <div className="grid grid-cols-1 sm:grid-cols-[8.5rem_7rem_1fr] gap-3">
        <div className="space-y-1">
          <span className={FIELD_LABEL}>Canal</span>
          <Select value={step.channel} onValueChange={(v) => onChange(index, { channel: v })}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <span className={FIELD_LABEL}>Délai</span>
          <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-sm border border-naya-olive-18">
            <Clock className="w-3.5 h-3.5 text-naya-olive-55 flex-shrink-0" />
            <span className="text-sm text-naya-olive-70 flex-shrink-0">J+</span>
            <input
              type="number"
              min={0}
              value={step.delayDays}
              onChange={(e) => onChange(index, { delayDays: Math.max(0, Number(e.target.value) || 0) })}
              className="w-full bg-transparent outline-none text-sm text-foreground"
              aria-label="Délai en jours après l'étape précédente"
            />
          </div>
        </div>

        <div className="space-y-1">
          <span className={FIELD_LABEL}>Intention</span>
          <Input
            value={step.intention}
            onChange={(e) => onChange(index, { intention: e.target.value })}
            placeholder="Ex. Présenter l'offre, relancer si pas de réponse…"
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1 w-fit">
        <span className={FIELD_LABEL}>Condition d'envoi</span>
        <Select value={step.condition} onValueChange={(v) => onChange(index, { condition: v })}>
          <SelectTrigger className="h-8 w-fit min-w-[9rem] text-xs px-2.5">
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
    </Card>
  );
}
