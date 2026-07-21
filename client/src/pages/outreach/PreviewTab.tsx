// Onglet Aperçu — la demande n°1 de Jeanne : choisir un VRAI prospect de la campagne et voir sa
// séquence rendue avec ses messages réels (pas un template) avant de lancer. Consomme l'endpoint
// /preview (Task 6 Plan 1, server/routes.ts) via usePreview — génération IA, donc potentiellement
// lente (quelques secondes) : le skeleton de droite doit rester agréable pendant l'attente.
//
// Deux volets : gauche = liste cherchable des prospects de CETTE campagne (score badge, sélection) ;
// droite = ARBRE de décision complet rendu pour le prospect sélectionné — chaque branche (« si
// invitation acceptée » / « non acceptée »…) montre le vrai message bespoke de ce prospect, en
// lecture seule, dans le même langage visuel que l'onglet Séquence (via SequenceTreeLayout, partagé).
// En bas, la CTA de lancement (enrôle TOUS les prospects, pas seulement celui prévisualisé), gardée
// par une AlertDialog de confirmation.
import { useMemo, useState } from 'react';
import { Search, Shuffle, Copy, RefreshCw, Clock, Rocket, Loader2, Inbox } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useLeads, usePreview, useLaunchCampaign } from './useOutreach';
import { channelMeta } from './channels';
import SequenceTreeLayout, { type TreeNodeRenderer } from './SequenceTreeLayout';
import { type PreviewStep } from './types';

interface PreviewTabProps {
  campaignId: number;
}

// Score → mêmes 3 tokens d'accent que channelMeta (mauve/sulphur/salvia), réutilisés via les
// variants Badge déjà câblés sur ces couleurs (client/src/components/ui/badge.tsx) — pas de
// nouvelle couleur en dur (cf. ancien LeadCard, git show 80a5a90, qui utilisait des rgba() bruts).
const SCORE_META: Record<string, { label: string; variant: 'mauve' | 'sulphur' | 'salvia' }> = {
  hot: { label: 'Chaud', variant: 'mauve' },
  warm: { label: 'Tiède', variant: 'sulphur' },
  cold: { label: 'Froid', variant: 'salvia' },
};

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function PreviewTab({ campaignId }: PreviewTabProps) {
  const { data: allLeads } = useLeads();
  const launchCampaign = useLaunchCampaign(campaignId);
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [leadId, setLeadId] = useState<number | null>(null);

  // Prospects de CETTE campagne, hors archivés — même filtre que CampaignWorkspace pour le compteur.
  const prospects = useMemo(
    () => (allLeads ?? []).filter((l) => l.prospectionCampaignId === campaignId && !l.archivedAt),
    [allLeads, campaignId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prospects;
    return prospects.filter(
      (l) => l.name.toLowerCase().includes(q) || (l.company ?? '').toLowerCase().includes(q),
    );
  }, [prospects, search]);

  const selectedLead = prospects.find((l) => l.id === leadId) ?? null;

  const handleRandom = () => {
    if (prospects.length === 0) return;
    const pick = prospects[Math.floor(Math.random() * prospects.length)];
    setLeadId(pick.id);
  };

  const { data: preview, isLoading, isFetching, refetch } = usePreview(campaignId, leadId);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copié', description: 'Le message est dans le presse-papiers.' });
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de copier le message.', variant: 'destructive' });
    }
  };

  // Il n'existe pas de régénération par étape côté serveur (une seule route /preview qui rend
  // toutes les étapes) — Régénérer refetch donc l'aperçu complet du prospect, que ce soit déclenché
  // depuis une étape en erreur ou depuis le bouton global.
  const handleRegenerate = () => {
    refetch();
  };

  const handleLaunch = () => {
    launchCampaign.mutate(undefined, {
      onSuccess: (data) => {
        toast({
          title: 'Campagne lancée',
          description: `${data.enrolled} prospect${data.enrolled > 1 ? 's' : ''} enrôlé${data.enrolled > 1 ? 's' : ''}.`,
        });
      },
      onError: () =>
        toast({ title: 'Erreur', description: 'Impossible de lancer la campagne.', variant: 'destructive' }),
    });
  };

  // La génération IA prend plusieurs secondes — on montre le skeleton tant que la requête est en
  // vol, y compris sur un refetch (Régénérer), pas seulement au premier chargement.
  const showSkeleton = leadId != null && (isLoading || isFetching);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── Volet gauche : liste des prospects ── */}
        <div className="w-80 flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border space-y-2.5 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-naya-olive-55 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Chercher un prospect…"
                className="pl-8 h-9 text-sm"
                aria-label="Chercher un prospect"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 w-full"
              disabled={prospects.length === 0}
              onClick={handleRandom}
            >
              <Shuffle className="w-3.5 h-3.5" />
              Prospect au hasard
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filtered.length === 0 ? (
                <p className="text-xs text-naya-olive-55 px-2 py-6 text-center">
                  {prospects.length === 0 ? 'Aucun prospect dans cette campagne.' : 'Aucun résultat.'}
                </p>
              ) : (
                filtered.map((lead) => {
                  const scoreMeta = SCORE_META[lead.score] ?? SCORE_META.cold;
                  const isSelected = lead.id === leadId;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => setLeadId(lead.id)}
                      className={`w-full flex items-center gap-2.5 rounded-md p-2 text-left transition-colors ${
                        isSelected ? 'bg-naya-sulphur/15 ring-1 ring-naya-olive' : 'hover:bg-naya-olive-06'
                      }`}
                    >
                      <Avatar className="w-7 h-7 flex-shrink-0">
                        <AvatarFallback className="text-[10px] bg-naya-mauve/20 text-naya-mauve font-medium">
                          {initials(lead.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{lead.name}</p>
                        {lead.company && <p className="text-[10px] text-naya-olive-55 truncate">{lead.company}</p>}
                      </div>
                      <Badge variant={scoreMeta.variant} className="flex-shrink-0">
                        {scoreMeta.label}
                      </Badge>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Volet droit : séquence rendue pour le prospect sélectionné ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-6">
              {!selectedLead ? (
                <EmptyState hasProspects={prospects.length > 0} />
              ) : showSkeleton ? (
                <PreviewSkeleton leadName={selectedLead.name} />
              ) : preview ? (
                <div className="max-w-2xl">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground truncate">{preview.lead.name}</h3>
                      {preview.lead.company && (
                        <p className="text-xs text-naya-olive-55 truncate">{preview.lead.company}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 flex-shrink-0"
                      onClick={handleRegenerate}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Régénérer tout
                    </Button>
                  </div>

                  {preview.steps.length === 0 ? (
                    <p className="text-sm text-naya-olive-55">
                      Cette campagne n'a pas encore de séquence — configure l'onglet Séquence d'abord.
                    </p>
                  ) : (
                    <SequenceTreeLayout
                      steps={preview.steps}
                      nodeKey={(node) => node.step.stepOrder}
                      renderNode={(node) => (
                        <PreviewMessageCard
                          step={node.step}
                          onCopy={handleCopy}
                          onRegenerate={handleRegenerate}
                        />
                      )}
                    />
                  )}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* ── CTA de lancement — enrôle TOUS les prospects de la campagne ── */}
      <div className="flex-shrink-0 border-t border-border bg-white px-6 py-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {prospects.length} prospect{prospects.length > 1 ? 's' : ''} dans cette campagne
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              className="gap-1.5 bg-primary text-primary-foreground"
              disabled={prospects.length === 0 || launchCampaign.isPending}
            >
              {launchCampaign.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              Lancer la campagne
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Lancer la campagne ?</AlertDialogTitle>
              <AlertDialogDescription>
                Naya enrôlera tous les prospects et démarrera la séquence.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={handleLaunch}>Lancer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function EmptyState({ hasProspects }: { hasProspects: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
      <div className="w-14 h-14 bg-naya-olive-10 rounded-lg flex items-center justify-center">
        <Inbox className="w-7 h-7 text-naya-mauve" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">
        {hasProspects
          ? 'Choisis un prospect pour voir sa séquence.'
          : "Aucun prospect dans cette campagne pour l'instant."}
      </p>
    </div>
  );
}

function PreviewSkeleton({ leadName }: { leadName: string }) {
  return (
    <div className="max-w-2xl">
      <div className="mb-4 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <p className="text-xs text-naya-olive-55">Naya rédige les messages pour {leadName}… quelques secondes.</p>
      </div>
      <div className="border-l-2 border-naya-olive-18 pl-6 space-y-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface PreviewMessageCardProps {
  step: PreviewStep;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
}

// Carte de message en lecture seule = CONTENU d'un nœud de l'arbre (le tronc/fourche/connecteur
// et le label de condition sont rendus par SequenceTreeLayout autour). D'où l'absence de badge de
// condition et de pastille de positionnement ici : le layout les fournit déjà.
function PreviewMessageCard({ step, onCopy, onRegenerate }: PreviewMessageCardProps) {
  const meta = channelMeta(step.channel);
  const Icon = meta.Icon;
  const isUnavailable = step.error || !step.body;

  return (
    <div className="relative">
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-naya-olive-55">
            <Clock className="w-3 h-3" />
            J+{step.delayDays}
          </span>
          {/* Intention rendue en texte (pas dans le composant Badge) : c'est souvent une phrase
              complète et Badge applique des small-caps tout-en-majuscules pensés pour des mots
              courts — une phrase y serait illisible. */}
          {step.intention && (
            <span className="text-xs text-naya-olive-70 italic truncate max-w-[16rem]">{step.intention}</span>
          )}
        </div>

        {isUnavailable ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-naya-olive-06 px-3 py-2.5">
            <p className="text-sm text-naya-olive-55">Message indisponible.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 flex-shrink-0"
              onClick={onRegenerate}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Régénérer
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {step.channel === 'email' && step.subject && (
              <p className="text-sm font-semibold text-foreground">{step.subject}</p>
            )}
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed rounded-md bg-naya-olive-06 px-3 py-2.5">
              {step.body}
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => onCopy(step.body!)}
              >
                <Copy className="w-3 h-3" />
                Copier
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={onRegenerate}
              >
                <RefreshCw className="w-3 h-3" />
                Régénérer
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
