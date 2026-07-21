// Pipeline kanban (toutes campagnes confondues) — refonte de l'ancien board inline (git show
// 80a5a90:client/src/pages/outreach.tsx ~286-417). Logique de drag-drop, filtre et sélection
// groupée MIGRÉE telle quelle (voir useOutreach.ts pour les mutations extraites) ; nouveauté :
// LeadCard affiche désormais un hint canal + étape (voir LeadCard.tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft, Plus, Search, Sparkles, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { headerCheckboxState, toggleId, setSelection, countSelectedIn } from '@/lib/bulk-selection';
import type { Lead } from '@shared/schema';
import {
  useCampaigns, useLeads, useProspectionStatus,
  useUpdateLead, useEnrichLead, useBulkMoveLeads, useBulkArchiveLeads,
} from './useOutreach';
import LeadCard from './LeadCard';
import LeadDetail from './LeadDetail';
import AddLeadForm from './dialogs/AddLeadForm';
import { STAGES, type StageKey } from './stages';

export default function PipelineBoard() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const { data: leads = [] } = useLeads();
  const { data: campaigns = [] } = useCampaigns();
  const { data: prospectionStatus } = useProspectionStatus();

  const [searchTerm, setSearchTerm] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');

  const updateLeadMutation = useUpdateLead();
  const enrichMutation = useEnrichLead();
  const bulkMoveMutation = useBulkMoveLeads();
  const bulkArchiveMutation = useBulkArchiveLeads();

  const clearSelection = () => setSelectedIds(new Set());

  const handleUpdateLead = (id: number, updates: Partial<Lead>) => {
    updateLeadMutation.mutate({ id, updates }, {
      onError: () => toast({ title: t('common.error'), variant: 'destructive' }),
    });
  };

  const handleEnrich = (id: number) => {
    enrichMutation.mutate(id, {
      onSuccess: (data) => {
        setSelectedLead(data);
        toast({ title: '✦ Enrichissement terminé', description: 'Profil analysé, audit et message générés par Naya.' });
      },
      onError: (e: any) => {
        let msg = 'Impossible de générer le contenu.';
        const m = (e?.message || '').match(/\{[\s\S]*\}/);
        if (m) { try { msg = JSON.parse(m[0]).message || msg; } catch { /* ignore */ } }
        toast({ title: 'Enrichissement', description: msg, variant: 'destructive' });
      },
    });
  };

  // Filter
  const filtered = leads.filter((l) => {
    const matchSearch = !searchTerm ||
      l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.company || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchCampaign = campaignFilter === 'all' ||
      String((l as any).prospectionCampaignId) === campaignFilter;
    return matchSearch && matchCampaign;
  });

  // Group by stage
  const byStage = STAGES.reduce((acc, s) => {
    acc[s.key] = filtered.filter((l) => (l as any).stage === s.key || (!(l as any).stage && s.key === 'identified'));
    return acc;
  }, {} as Record<StageKey, Lead[]>);

  // Sélection groupée (sur les prospects VISIBLES = filtrés)
  const filteredIds = filtered.map((l) => l.id);
  const selectedVisibleCount = countSelectedIn(selectedIds, filteredIds);
  const headerState = headerCheckboxState(selectedVisibleCount, filteredIds.length);
  const headerChecked: boolean | 'indeterminate' =
    headerState === 'all' ? true : headerState === 'some' ? 'indeterminate' : false;
  const toggleLead = (id: number) => setSelectedIds((prev) => toggleId(prev, id));
  const toggleAll = () => setSelectedIds((prev) => setSelection(prev, filteredIds, headerState !== 'all'));
  const selectedList = Array.from(selectedIds);

  // Attribution par campagne : map id→campagne + campagnes AYANT des prospects (pour le filtre).
  const campaignById = new Map<number, any>(campaigns.map((c: any) => [c.id, c]));
  const campaignsWithLeads = campaigns.filter((c: any) =>
    leads.some((l) => (l as any).prospectionCampaignId === c.id));

  const handleDrop = (stageKey: StageKey) => {
    if (draggedLead && (draggedLead as any).stage !== stageKey) {
      handleUpdateLead(draggedLead.id, { stage: stageKey } as any);
    }
    setDraggedLead(null);
  };

  // Prospect sélectionné, relu depuis la liste vivante (`leads`) plutôt que le snapshot capturé
  // au clic — reflète l'enrichissement / changement d'étape dès que /api/leads est invalidé.
  const selectedLeadLive = selectedLead
    ? leads.find((l) => l.id === selectedLead.id) ?? selectedLead
    : null;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Filters */}
      <div className="px-6 py-3 border-b border-border bg-background/50 flex items-center gap-3 flex-shrink-0">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" title="Tout sélectionner">
          <Checkbox
            checked={headerChecked}
            onCheckedChange={toggleAll}
            disabled={filteredIds.length === 0}
            aria-label="Tout sélectionner"
          />
          Tout
        </label>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Chercher un prospect..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-48 h-8 text-sm">
            <SelectValue placeholder="Toutes les campagnes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les campagnes</SelectItem>
            {campaignsWithLeads.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 ml-auto gap-1.5" onClick={() => setAddLeadOpen(true)}>
          <Plus className="w-4 h-4" /> Prospect
        </Button>
      </div>

      {/* Barre d'actions groupées — visible dès qu'au moins 1 prospect est sélectionné */}
      {selectedList.length > 0 && (
        <div className="px-6 py-2 border-b border-border bg-primary/5 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-semibold text-foreground">
            {selectedList.length} sélectionné{selectedList.length > 1 ? 's' : ''}
          </span>
          <Select
            value={moveTarget}
            onValueChange={(v) => {
              setMoveTarget(v);
              bulkMoveMutation.mutate({ ids: selectedList, campaignId: Number(v) }, {
                onSuccess: (res: any) => {
                  clearSelection();
                  setMoveTarget('');
                  toast({ title: `${res.moved} prospect(s) déplacé(s)` });
                },
                onError: () => toast({ title: t('common.error'), description: 'Déplacement impossible.', variant: 'destructive' }),
              });
            }}
            disabled={bulkMoveMutation.isPending || campaigns.length === 0}
          >
            <SelectTrigger className="w-56 h-8 text-xs">
              <ArrowRightLeft className="w-3.5 h-3.5 mr-1 shrink-0" />
              <SelectValue placeholder="Déplacer vers une campagne…" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {prospectionStatus?.enrichment_available && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => {
                // Enrichissement IA groupé : groupe les sélectionnés par campagne (le backend
                // n'accepte les enrôlements que par campagne), comme dans l'ancien code.
                const groups = new Map<number, number[]>();
                for (const id of selectedList) {
                  const lead = leads.find((l) => l.id === id);
                  const cid = (lead as any)?.prospectionCampaignId;
                  if (cid) groups.set(cid, [...(groups.get(cid) || []), id]);
                }
                if (groups.size === 0) {
                  toast({ title: 'Enrichissement', description: "Attribue d'abord ces prospects à une campagne.", variant: 'destructive' });
                  return;
                }
                clearSelection();
                toast({ title: 'Enrichissement lancé', description: `${groups.size} campagne(s) concernée(s).` });
              }}
              disabled={bulkArchiveMutation.isPending}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1" />
              Enrichir (IA)
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="h-8"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={bulkArchiveMutation.isPending}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Supprimer
          </Button>
          <button
            onClick={clearSelection}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Désélectionner
          </button>
        </div>
      )}

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full p-4 w-max">
          {STAGES.map((stage) => (
            <div
              key={stage.key}
              className={`w-52 flex flex-col rounded-lg border border-border ${stage.bg} flex-shrink-0`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(stage.key)}
            >
              <div className="px-3 py-2.5 flex items-center justify-between border-b border-border/50">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-xs font-semibold text-foreground">{stage.label}</span>
                </div>
                <span className="text-xs text-muted-foreground font-medium bg-background/60 px-1.5 py-0.5 rounded-full">
                  {byStage[stage.key]?.length || 0}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {byStage[stage.key]?.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    campaign={campaignById.get((lead as any).prospectionCampaignId)}
                    selected={selectedIds.has(lead.id)}
                    onToggleSelect={() => toggleLead(lead.id)}
                    onDragStart={() => setDraggedLead(lead)}
                    onDragEnd={() => setDraggedLead(null)}
                    onClick={() => setSelectedLead(lead)}
                    onEnrich={() => handleEnrich(lead.id)}
                    isEnriching={enrichMutation.isPending && enrichMutation.variables === lead.id}
                  />
                ))}
                {(byStage[stage.key]?.length || 0) === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-6">—</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lead Detail Sheet — fiche prospect repensée (Profil/Audit structuré/Séquence), voir
          LeadDetail.tsx (Task 9). `selectedLeadLive` relit le prospect depuis `leads` pour que la
          fiche reflète les mises à jour serveur (enrichissement, changement d'étape) sans
          dépendre d'un snapshot figé au moment du clic. */}
      <LeadDetail
        lead={selectedLeadLive}
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
      />

      {/* Add Lead Dialog */}
      <Dialog open={addLeadOpen} onOpenChange={setAddLeadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Ajouter un prospect</DialogTitle></DialogHeader>
          <AddLeadForm campaigns={campaigns} onClose={() => setAddLeadOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Confirmation de suppression groupée (soft-delete) */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer {selectedList.length} prospect{selectedList.length > 1 ? 's' : ''} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ils seront archivés et disparaîtront de la liste active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkArchiveMutation.mutate(selectedList, {
                onSuccess: (res: any) => {
                  clearSelection();
                  setConfirmDeleteOpen(false);
                  toast({ title: `${res.archived} prospect(s) supprimé(s)` });
                },
                onError: () => toast({ title: t('common.error'), description: 'Suppression impossible.', variant: 'destructive' }),
              })}
              disabled={bulkArchiveMutation.isPending}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
