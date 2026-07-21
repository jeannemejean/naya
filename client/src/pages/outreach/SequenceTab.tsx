// Onglet Séquence de CampaignWorkspace — bannière de rationale IA + timeline visuelle éditable
// + enregistrement. Reprend le câblage (endpoints generate/save) de l'ancien SequenceEditorDialog
// (git history, client/src/pages/outreach.tsx ~1431-1538) mais avec une vue neuve (timeline, pas
// une modale à plat) et lit bien { rationale, steps } du generate (pas un tableau nu).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useGenerateSequence, useSaveSequence, useSequence } from './useOutreach';
import SequenceTimeline from './SequenceTimeline';
import type { DraftSequenceStep, SequenceStepDTO } from './types';

interface SequenceTabProps {
  campaignId: number;
}

function toDraft(step: SequenceStepDTO): DraftSequenceStep {
  return {
    id: step.id,
    stepOrder: step.stepOrder,
    channel: step.channel,
    delayDays: step.delayDays,
    intention: step.intention ?? '',
    condition: step.condition,
  };
}

export default function SequenceTab({ campaignId }: SequenceTabProps) {
  const { data: fetched, isLoading } = useSequence(campaignId);
  const generateSequence = useGenerateSequence(campaignId);
  const saveSequence = useSaveSequence(campaignId);
  const { toast } = useToast();

  const [draft, setDraft] = useState<DraftSequenceStep[]>([]);
  const [rationale, setRationale] = useState<string | null>(null);
  const seeded = useRef(false);

  // Seed le brouillon local une seule fois, au premier chargement de la séquence persistée —
  // les modifications suivantes du brouillon ne doivent pas être écrasées par un refetch.
  useEffect(() => {
    if (fetched && !seeded.current) {
      seeded.current = true;
      setDraft(fetched.map(toDraft));
    }
  }, [fetched]);

  const baseline = useMemo(() => (fetched ?? []).map(toDraft), [fetched]);
  const isDirty = useMemo(() => {
    const normalizedDraft = draft.map((s, i) => ({ ...s, stepOrder: i + 1 }));
    return JSON.stringify(normalizedDraft) !== JSON.stringify(baseline);
  }, [draft, baseline]);

  const handleChange = (index: number, partial: Partial<DraftSequenceStep>) =>
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...partial } : s)));

  const handleRemove = (index: number) => setDraft((prev) => prev.filter((_, i) => i !== index));

  const handleMove = (index: number, direction: -1 | 1) =>
    setDraft((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const handleAdd = () =>
    setDraft((prev) => [...prev, { channel: 'email', delayDays: 3, intention: '', condition: 'always' }]);

  const handleGenerate = () => {
    generateSequence.mutate(undefined, {
      onSuccess: (data) => {
        setRationale(data.rationale);
        setDraft(data.steps.map(toDraft));
        toast({ title: '✦ Plan généré par Naya', description: "Relis et ajuste avant d'enregistrer." });
      },
      onError: () => toast({ title: 'Erreur', description: 'Génération impossible — réessaie.', variant: 'destructive' }),
    });
  };

  const handleSave = () => {
    const payload = draft.map((s, i) => ({
      id: s.id,
      stepOrder: i + 1,
      channel: s.channel,
      delayDays: s.delayDays,
      intention: s.intention,
      condition: s.condition,
    }));
    saveSequence.mutate(payload, {
      // Re-synchronise le brouillon avec la réponse serveur (ids réels pour les étapes ajoutées,
      // stepOrder canonique) — sans ça, isDirty resterait vrai juste après un save réussi.
      onSuccess: (saved) => {
        setDraft(saved.map(toDraft));
        toast({ title: 'Séquence enregistrée', description: `${saved.length} étape${saved.length > 1 ? 's' : ''}.` });
      },
      onError: () =>
        toast({ title: 'Erreur', description: "Impossible d'enregistrer la séquence.", variant: 'destructive' }),
    });
  };

  return (
    <div className="p-6 space-y-5">
      <div className="rounded-lg border border-naya-olive-18 bg-naya-sulphur/10 p-4 flex flex-col sm:flex-row sm:items-start gap-3">
        <Sparkles className="w-4 h-4 text-naya-sulphur mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Plan conçu par Naya</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rationale ?? 'Génère un plan pour démarrer — Naya propose une séquence adaptée au secteur et au signal d\'achat de la campagne.'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 flex-shrink-0"
          disabled={generateSequence.isPending}
          onClick={handleGenerate}
        >
          {generateSequence.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {generateSequence.isPending ? 'Génération…' : 'Repenser (IA)'}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {draft.length} étape{draft.length > 1 ? 's' : ''}
        </p>
        <Button type="button" size="sm" className="gap-1.5" disabled={!isDirty || saveSequence.isPending} onClick={handleSave}>
          {saveSequence.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Enregistrer
        </Button>
      </div>

      {isLoading ? (
        <div className="max-w-2xl space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <SequenceTimeline
          steps={draft}
          onChange={handleChange}
          onRemove={handleRemove}
          onMove={handleMove}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
