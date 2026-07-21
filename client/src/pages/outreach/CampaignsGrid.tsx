// Grille de campagnes — remplace l'ancienne liste dense CampaignsTab (git history,
// client/src/pages/outreach.tsx ~935-1200) par des cartes cliquables (CampaignCard) qui
// naviguent vers /outreach/campaigns/:id (Task 4+).
import { useMemo, useState } from 'react';
import { Plus, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCampaigns, useLeads } from './useOutreach';
import CampaignCard, { type CampaignLeadCount } from './CampaignCard';
import CampaignForm from './dialogs/CampaignForm';

export default function CampaignsGrid() {
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: leads } = useLeads();
  const [formOpen, setFormOpen] = useState(false);

  const leadCounts = useMemo(() => {
    const byCampaign = new Map<number, CampaignLeadCount>();
    for (const lead of leads ?? []) {
      const campaignId = (lead as any).prospectionCampaignId;
      if (campaignId == null || (lead as any).archivedAt) continue;
      const entry = byCampaign.get(campaignId) ?? { total: 0, ready: 0 };
      entry.total += 1;
      if ((lead as any).stage === 'messages_ready') entry.ready += 1;
      byCampaign.set(campaignId, entry);
    }
    return byCampaign;
  }, [leads]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {campaigns?.length ?? 0} campagne{(campaigns?.length ?? 0) > 1 ? 's' : ''}
        </p>
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <Button size="sm" className="gap-1.5" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4" />
            Nouvelle campagne
          </Button>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nouvelle campagne</DialogTitle>
            </DialogHeader>
            <CampaignForm onClose={() => setFormOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !campaigns || campaigns.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="w-14 h-14 bg-naya-olive-10 rounded-lg flex items-center justify-center mx-auto">
            <Target className="w-7 h-7 text-naya-mauve" />
          </div>
          <p className="text-sm font-medium text-foreground">Crée ta première campagne</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Structure ta prospection par secteur, canal et signal d'achat pour laisser Naya générer
            les séquences et les messages.
          </p>
          <Button size="sm" className="gap-1.5" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4" />
            Nouvelle campagne
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign: any) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              leadCount={leadCounts.get(campaign.id) ?? { total: 0, ready: 0 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
