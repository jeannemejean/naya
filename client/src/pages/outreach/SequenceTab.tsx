// Onglet Séquence de CampaignWorkspace — bannière de rationale IA + arbre de décision visuel
// éditable (SequenceTree) + enregistrement. Reprend le câblage (endpoints generate/save) de
// l'ancien SequenceEditorDialog (git history, client/src/pages/outreach.tsx ~1431-1538) mais avec
// une vue neuve (arbre, pas une modale à plat) et lit bien { rationale, steps } du generate (pas
// un tableau nu).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import {
  useGenerateSequence,
  useSaveSequence,
  useSequence,
  useCampaign,
  useWritingInstructions,
  useSaveWritingInstructions,
  useUpdateCampaign,
} from './useOutreach';
import SequenceTree from './SequenceTree';
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

// Panneau collapsible « Consignes de rédaction pour Naya » — consignes GLOBALES (toutes
// campagnes, stockées sur userPreferences) + consignes PAR CAMPAGNE (override/complément,
// stockées sur la campagne). Les deux sont cumulées côté serveur au moment de la génération
// (combineInstructions dans server/services/sequence-message.ts) : le global s'applique
// toujours, la campagne vient s'y ajouter.
function WritingInstructionsPanel({ campaignId }: { campaignId: number }) {
  const { data: writingInstructions, isLoading: loadingGlobal } = useWritingInstructions();
  const { data: campaign } = useCampaign(campaignId);
  const saveGlobal = useSaveWritingInstructions();
  const updateCampaign = useUpdateCampaign(campaignId);
  const { toast } = useToast();

  const [globalText, setGlobalText] = useState('');
  const [campaignText, setCampaignText] = useState('');
  const seededGlobal = useRef(false);
  const seededCampaign = useRef(false);

  useEffect(() => {
    if (writingInstructions && !seededGlobal.current) {
      seededGlobal.current = true;
      setGlobalText(writingInstructions.global ?? '');
    }
  }, [writingInstructions]);

  useEffect(() => {
    if (campaign && !seededCampaign.current) {
      seededCampaign.current = true;
      setCampaignText(campaign.messageInstructions ?? '');
    }
  }, [campaign]);

  const isPending = saveGlobal.isPending || updateCampaign.isPending;

  const handleSave = async () => {
    try {
      await Promise.all([
        saveGlobal.mutateAsync({ global: globalText }),
        updateCampaign.mutateAsync({ messageInstructions: campaignText.trim() || null }),
      ]);
      toast({ title: 'Consignes enregistrées', description: 'Naya en tiendra compte dès la prochaine génération.' });
    } catch {
      toast({ title: 'Erreur', description: "Impossible d'enregistrer les consignes.", variant: 'destructive' });
    }
  };

  return (
    <Accordion type="single" collapsible defaultValue="writing-instructions" className="rounded-lg border border-naya-olive-18 px-4">
      <AccordionItem value="writing-instructions" className="border-b-0">
        <AccordionTrigger className="hover:no-underline">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <PenLine className="w-4 h-4 text-naya-olive-55" />
            Consignes de rédaction pour Naya
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="writing-instructions-global" className="text-xs font-medium text-naya-olive-70">
                Globales — appliquées à toutes tes campagnes
              </Label>
              <Textarea
                id="writing-instructions-global"
                value={globalText}
                onChange={(e) => setGlobalText(e.target.value)}
                disabled={loadingGlobal}
                placeholder="Ex. Jamais de tiret long. Ton direct et humain. Pas de « j'espère que vous allez bien »."
                className="min-h-[88px] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="writing-instructions-campaign" className="text-xs font-medium text-naya-olive-70">
                Cette campagne (optionnel)
              </Label>
              <Textarea
                id="writing-instructions-campaign"
                value={campaignText}
                onChange={(e) => setCampaignText(e.target.value)}
                placeholder="Ex. Mentionne toujours l'offre de lancement early-bird."
                className="min-h-[72px] text-sm"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="gap-1.5 bg-primary text-primary-foreground"
                disabled={isPending}
                onClick={handleSave}
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Enregistrer les consignes
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export default function SequenceTab({ campaignId }: SequenceTabProps) {
  const { data: fetched, isLoading } = useSequence(campaignId);
  const generateSequence = useGenerateSequence(campaignId);
  const saveSequence = useSaveSequence(campaignId);
  const { toast } = useToast();

  const [draft, setDraft] = useState<DraftSequenceStep[]>([]);
  const [rationale, setRationale] = useState<string | null>(null);
  // Tant que ce flag est faux, aucun indice n'affiche son état invalide — évite de peindre les
  // cartes en rouge dès l'ajout d'une étape, avant même une tentative de sauvegarde.
  const [saveAttempted, setSaveAttempted] = useState(false);
  const seeded = useRef(false);
  const keyCounter = useRef(0);

  // Clé stable UI-only pour une étape pas encore persistée (voir DraftSequenceStep._key).
  const makeDraftKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    keyCounter.current += 1;
    return `draft-key-${keyCounter.current}`;
  };

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
    setDraft((prev) => [
      ...prev,
      { channel: 'email', delayDays: 3, intention: '', condition: 'always', _key: makeDraftKey() },
    ]);

  // Une étape doit porter une intention (le body-only vient de l'ancien flux "builder à plat" —
  // DraftSequenceStep ne porte jamais de bodyTemplate ici, la timeline est le PLAN, pas le
  // message final, cf. SequenceStepCard) — sinon le keep-filter serveur (server/routes.ts
  // ~L7004-7008) la droppe silencieusement au save.
  const invalidIndices = useMemo(
    () => new Set(draft.map((s, i) => (s.intention.trim() ? -1 : i)).filter((i) => i >= 0)),
    [draft],
  );

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
    if (invalidIndices.size > 0) {
      setSaveAttempted(true);
      toast({
        title: 'Intention manquante',
        description: "Chaque étape doit avoir une intention avant d'enregistrer.",
        variant: 'destructive',
      });
      return;
    }
    setSaveAttempted(false);
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
      <WritingInstructionsPanel campaignId={campaignId} />

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
        <SequenceTree
          steps={draft}
          onChange={handleChange}
          onRemove={handleRemove}
          onMove={handleMove}
          onAdd={handleAdd}
          invalidIndices={saveAttempted ? invalidIndices : undefined}
        />
      )}
    </div>
  );
}
