// Onglet Prospects de l'espace de travail d'une campagne (Task 10) — liste scoped des prospects
// de CETTE campagne + points d'entrée pour en trouver/ajouter davantage. Assemblage de pièces
// existantes (pas de nouveau backend) : LeadFinderDialog (Task 8, sans trigger jusqu'ici),
// AddLeadForm, LeadDetail. La liste est un composant compact dédié (pas LeadCard) : LeadCard porte
// des affordances kanban (drag, sélection groupée, badge de campagne) hors-sujet dans un onglet
// déjà scoped à une seule campagne — cf. note de la tâche ("your call for readability").
import { useState } from 'react';
import { Plus, Sparkles, Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCampaign, useCampaigns, useLeads } from './useOutreach';
import { SCORE_LABEL, SCORE_VARIANT } from './LeadCard';
import { STAGE_MAP, type StageKey } from './stages';
import LeadDetail from './LeadDetail';
import AddLeadForm from './dialogs/AddLeadForm';
import LeadFinderDialog from './dialogs/LeadFinderDialog';
import type { Lead } from '@shared/schema';

interface ProspectsTabProps {
  campaignId: number;
}

export default function ProspectsTab({ campaignId }: ProspectsTabProps) {
  const { data: campaign } = useCampaign(campaignId);
  const { data: campaigns = [] } = useCampaigns();
  const { data: leads = [] } = useLeads();

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [leadFinderOpen, setLeadFinderOpen] = useState(false);

  const prospects = leads.filter(
    (l) => (l as any).prospectionCampaignId === campaignId && !(l as any).archivedAt,
  );

  // Relit le prospect sélectionné depuis la liste vivante — reflète enrichissement / changement
  // d'étape sans dépendre du snapshot capturé au clic (même pattern que PipelineBoard).
  const selectedLeadLive = selectedLead
    ? prospects.find((l) => l.id === selectedLead.id) ?? selectedLead
    : null;

  return (
    <div className="p-6 space-y-4">
      {/* Header : compteur + actions */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="w-3.5 h-3.5" />
          {prospects.length} prospect{prospects.length > 1 ? 's' : ''}
        </span>
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
        </div>
      </div>

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
            <ProspectRow key={lead.id} lead={lead} onClick={() => setSelectedLead(lead)} />
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
// name, entreprise, score, étape — volontairement plus léger que LeadCard (pas de kanban ici).

function ProspectRow({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const l = lead as any;
  const stage = STAGE_MAP[(l.stage as StageKey)] || STAGE_MAP.identified;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-white hover:border-naya-mauve/40 hover:bg-muted/30 transition-colors text-left"
    >
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
      </div>
    </button>
  );
}
