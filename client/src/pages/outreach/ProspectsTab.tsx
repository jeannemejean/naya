// Onglet Prospects de l'espace de travail d'une campagne (Task 10) — liste scoped des prospects
// de CETTE campagne + points d'entrée pour en trouver/ajouter davantage. Assemblage de pièces
// existantes (pas de nouveau backend) : LeadFinderDialog (Task 8, sans trigger jusqu'ici),
// AddLeadForm, LeadDetail. La liste est un composant compact dédié (pas LeadCard) : LeadCard porte
// des affordances kanban (drag, sélection groupée, badge de campagne) hors-sujet dans un onglet
// déjà scoped à une seule campagne — cf. note de la tâche ("your call for readability").
//
// Sélection manuelle des prospects à enrôler (owner-chosen) : checkbox par ligne (réutilise
// @/lib/bulk-selection, même pattern que PipelineBoard/LeadCard) + badge de statut d'enrôlement
// (GET .../enrollments) + barre d'actions groupées pour ajouter/retirer de la séquence. "Lancer
// pour tous" reste disponible en raccourci (même comportement que l'onglet Aperçu).
import { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Circle, Hand, Loader2, PauseCircle, PlayCircle,
  Plus, Rocket, Sparkles, Users, X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { headerCheckboxState, toggleId, setSelection, countSelectedIn } from '@/lib/bulk-selection';
import {
  useCampaign, useCampaigns, useLeads, useSequence,
  useEnrollments, useBulkEnroll, useUnenrollLead, useLaunchCampaign,
} from './useOutreach';
import { SCORE_LABEL, SCORE_VARIANT } from './LeadCard';
import { STAGE_MAP, type StageKey } from './stages';
import LeadDetail from './LeadDetail';
import AddLeadForm from './dialogs/AddLeadForm';
import LeadFinderDialog from './dialogs/LeadFinderDialog';
import type { Lead } from '@shared/schema';

interface ProspectsTabProps {
  campaignId: number;
}

// Statut d'enrôlement → libellé + variant Badge (tokens sanctionnés naya-olive/mauve/sulphur/
// salvia, cf. badge.tsx) + icône. Pas de couleur en dur — mêmes 4 accents que LeadCard/ResultsTab.
const STATUS_META: Record<string, { label: string; variant: NonNullable<BadgeProps['variant']>; Icon: typeof Circle }> = {
  none: { label: 'Pas en séquence', variant: 'outline', Icon: Circle },
  active: { label: 'En séquence', variant: 'salvia', Icon: PlayCircle },
  stopped_replied: { label: 'A répondu', variant: 'sulphur', Icon: Hand },
  completed: { label: 'Terminé', variant: 'default', Icon: CheckCircle2 },
  paused: { label: 'En pause', variant: 'outline', Icon: PauseCircle },
  bounced: { label: 'Bounce', variant: 'destructive', Icon: AlertTriangle },
  failed: { label: 'Échec', variant: 'destructive', Icon: AlertTriangle },
};

export default function ProspectsTab({ campaignId }: ProspectsTabProps) {
  const { data: campaign } = useCampaign(campaignId);
  const { data: campaigns = [] } = useCampaigns();
  const { data: leads = [] } = useLeads();
  const { data: sequenceSteps = [] } = useSequence(campaignId);
  const { data: enrollments = [] } = useEnrollments(campaignId);
  const { toast } = useToast();

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [leadFinderOpen, setLeadFinderOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const bulkEnroll = useBulkEnroll(campaignId);
  const unenrollLead = useUnenrollLead(campaignId);
  const launchCampaign = useLaunchCampaign(campaignId);

  const hasSequence = sequenceSteps.length > 0;

  const prospects = leads.filter(
    (l) => (l as any).prospectionCampaignId === campaignId && !(l as any).archivedAt,
  );

  const statusByLead = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of enrollments) m.set(e.leadId, e.status);
    return m;
  }, [enrollments]);

  // Relit le prospect sélectionné depuis la liste vivante — reflète enrichissement / changement
  // d'étape sans dépendre du snapshot capturé au clic (même pattern que PipelineBoard).
  const selectedLeadLive = selectedLead
    ? prospects.find((l) => l.id === selectedLead.id) ?? selectedLead
    : null;

  // Sélection groupée (checkboxes) — mêmes helpers purs que PipelineBoard/LeadCard.
  const clearSelection = () => setSelectedIds(new Set());
  const prospectIds = prospects.map((l) => l.id);
  const selectedVisibleCount = countSelectedIn(selectedIds, prospectIds);
  const headerState = headerCheckboxState(selectedVisibleCount, prospectIds.length);
  const headerChecked: boolean | 'indeterminate' =
    headerState === 'all' ? true : headerState === 'some' ? 'indeterminate' : false;
  const toggleLead = (id: number) => setSelectedIds((prev) => toggleId(prev, id));
  const toggleAll = () => setSelectedIds((prev) => setSelection(prev, prospectIds, headerState !== 'all'));
  const selectedList = Array.from(selectedIds);
  // Parmi la sélection, ceux qui ont déjà un état (n'importe quel statut) — candidats au retrait.
  const selectedEnrolledIds = selectedList.filter((id) => statusByLead.has(id));

  const handleBulkEnroll = () => {
    bulkEnroll.mutate(selectedList, {
      onSuccess: (res) => {
        clearSelection();
        toast({
          title: 'Séquence',
          description: `${res.enrolled} prospect${res.enrolled > 1 ? 's' : ''} enrôlé${res.enrolled > 1 ? 's' : ''}`
            + (res.skipped ? `, ${res.skipped} déjà en cours ou hors campagne.` : '.'),
        });
      },
      onError: () => toast({ title: 'Erreur', description: "Impossible d'enrôler la sélection.", variant: 'destructive' }),
    });
  };

  const handleBulkUnenroll = async () => {
    try {
      await Promise.all(selectedEnrolledIds.map((id) => unenrollLead.mutateAsync(id)));
      clearSelection();
      toast({
        title: 'Séquence',
        description: `${selectedEnrolledIds.length} prospect${selectedEnrolledIds.length > 1 ? 's' : ''} retiré${selectedEnrolledIds.length > 1 ? 's' : ''} de la séquence.`,
      });
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de retirer certains prospects.', variant: 'destructive' });
    }
  };

  const handleLaunch = () => {
    launchCampaign.mutate(undefined, {
      onSuccess: (data) => {
        toast({
          title: 'Campagne lancée',
          description: `${data.enrolled} prospect${data.enrolled > 1 ? 's' : ''} enrôlé${data.enrolled > 1 ? 's' : ''}.`,
        });
      },
      onError: () => toast({ title: 'Erreur', description: 'Impossible de lancer la campagne.', variant: 'destructive' }),
    });
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header : sélection + compteur + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" title="Tout sélectionner">
            <Checkbox
              checked={headerChecked}
              onCheckedChange={toggleAll}
              disabled={prospectIds.length === 0}
              aria-label="Tout sélectionner"
            />
            Tout
          </label>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            {prospects.length} prospect{prospects.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setLeadFinderOpen(true)}
            disabled={!campaign}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Trouver des prospects (IA)
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-primary text-primary-foreground hover:opacity-90"
            onClick={() => setAddLeadOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un prospect
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!hasSequence || prospects.length === 0 || launchCampaign.isPending}
                title={!hasSequence ? "Définis d'abord une séquence dans l'onglet Séquence." : undefined}
              >
                {launchCampaign.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Rocket className="w-3.5 h-3.5" />
                )}
                Lancer pour tous
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lancer la campagne pour tous les prospects ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Naya enrôlera tous les prospects de cette campagne (hors ceux déjà en séquence) et démarrera l'envoi.
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

      {!hasSequence && (
        <p className="text-xs text-naya-olive-55">
          Définis d'abord une séquence dans l'onglet Séquence pour pouvoir enrôler des prospects.
        </p>
      )}

      {/* Barre d'actions groupées — visible dès qu'au moins 1 prospect est sélectionné */}
      {selectedList.length > 0 && (
        <div className="px-4 py-2 rounded-lg border border-border bg-primary/5 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-foreground">
            {selectedList.length} sélectionné{selectedList.length > 1 ? 's' : ''}
          </span>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-primary text-primary-foreground hover:opacity-90"
            onClick={handleBulkEnroll}
            disabled={!hasSequence || bulkEnroll.isPending}
            title={!hasSequence ? "Définis d'abord une séquence dans l'onglet Séquence." : undefined}
          >
            {bulkEnroll.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            Ajouter la sélection à la séquence
          </Button>
          {selectedEnrolledIds.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={handleBulkUnenroll}
              disabled={unenrollLead.isPending}
            >
              Retirer de la séquence
            </Button>
          )}
          <button
            onClick={clearSelection}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Désélectionner
          </button>
        </div>
      )}

      {/* Liste */}
      {prospects.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Aucun prospect pour l'instant — trouve-en avec l'IA ou ajoute-les à la main.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {prospects.map((lead) => (
            <ProspectRow
              key={lead.id}
              lead={lead}
              status={statusByLead.get(lead.id)}
              selected={selectedIds.has(lead.id)}
              onToggleSelect={() => toggleLead(lead.id)}
              onClick={() => setSelectedLead(lead)}
            />
          ))}
        </div>
      )}

      {/* Fiche prospect */}
      <LeadDetail
        lead={selectedLeadLive}
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
      />

      {/* Ajout manuel — campagne courante présélectionnée */}
      <Dialog open={addLeadOpen} onOpenChange={setAddLeadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Ajouter un prospect</DialogTitle></DialogHeader>
          <AddLeadForm
            campaigns={campaigns}
            defaultCampaignId={campaignId}
            onClose={() => setAddLeadOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Lead Finder IA — ICP + requêtes de sourcing, sourcing automatique inclus si disponible */}
      {leadFinderOpen && campaign && (
        <LeadFinderDialog campaign={campaign} onClose={() => setLeadFinderOpen(false)} />
      )}
    </div>
  );
}

// ─── Ligne de prospect compacte ────────────────────────────────────────────────
// checkbox + name, entreprise, score, étape, statut de séquence — volontairement plus léger que
// LeadCard (pas de kanban ici). Div (pas <button>) car elle contient désormais un Checkbox
// interactif : la checkbox stoppe la propagation pour ne pas ouvrir le détail (même pattern que
// LeadCard.tsx).

function ProspectRow({
  lead, status, selected, onToggleSelect, onClick,
}: {
  lead: Lead;
  status?: string;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const l = lead as any;
  const stage = STAGE_MAP[(l.stage as StageKey)] || STAGE_MAP.identified;
  const statusMeta = STATUS_META[status ?? 'none'] ?? STATUS_META.none;
  const StatusIcon = statusMeta.Icon;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-white hover:border-naya-mauve/40 hover:bg-muted/30 transition-colors text-left cursor-pointer ${
        selected ? 'border-naya-mauve ring-1 ring-naya-mauve' : 'border-border'
      }`}
    >
      {/* Checkbox de sélection — stopPropagation pour ne pas ouvrir le détail */}
      <span
        className="flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Sélectionner ${lead.name}`} />
      </span>

      <Avatar className="w-8 h-8 flex-shrink-0">
        <AvatarFallback className="text-[10px] bg-naya-mauve/20 text-naya-mauve font-medium">
          {lead.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{lead.name}</p>
        {(lead.company || l.role) && (
          <p className="text-xs text-muted-foreground truncate">
            {[lead.company, l.role].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
          {stage.label}
        </span>
        {SCORE_VARIANT[lead.score] && (
          <Badge variant={SCORE_VARIANT[lead.score]} className="px-1.5 py-0.5 text-[10px]">
            {SCORE_LABEL[lead.score]}
          </Badge>
        )}
        <Badge variant={statusMeta.variant} className="px-1.5 py-0.5 text-[10px] gap-1">
          <StatusIcon className="w-3 h-3" />
          {statusMeta.label}
        </Badge>
      </div>
    </div>
  );
}
