// Formulaire de création (et édition) de campagne de prospection — repris quasi-verbatim de
// l'ancien client/src/pages/outreach.tsx (CampaignForm, ~lignes 1308-1421). POSTe directement
// sur /api/prospection/campaigns et invalide le cache campagnes au succès.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface CampaignFormProps {
  onClose: () => void;
  initial?: any;
}

export default function CampaignForm({ onClose, initial }: CampaignFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name || '',
    status: initial?.status || 'active',
    targetSector: initial?.targetSector || '',
    digitalLevel: initial?.digitalLevel || 'tous',
    channel: initial?.channel || 'linkedin',
    offer: initial?.offer || '',
    prospectsPerDay: String(initial?.prospectsPerDay || '3'),
    buyingSignals: initial?.buyingSignals || '',
    campaignBrief: initial?.campaignBrief || '',
    messageAngle: initial?.messageAngle || '',
  });

  const createCampaign = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/prospection/campaigns', data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prospection/campaigns'] });
      toast({ title: 'Campagne créée' });
      onClose();
    },
    onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    createCampaign.mutate({ ...form, prospectsPerDay: Number(form.prospectsPerDay) });
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label className="text-xs">Nom de la campagne *</Label>
        <Input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className="h-8 text-sm"
          placeholder="Vignobles — Tourisme international"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Secteur cible</Label>
          <Input
            value={form.targetSector}
            onChange={(e) => set('targetSector', e.target.value)}
            className="h-8 text-sm"
            placeholder="Viticulture, Oenotourisme..."
          />
        </div>
        <div>
          <Label className="text-xs">Canal</Label>
          <Select value={form.channel} onValueChange={(v) => set('channel', v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="both">LinkedIn + Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Niveau digital</Label>
          <Select value={form.digitalLevel} onValueChange={(v) => set('digitalLevel', v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fort">Fort (+5K abonnés)</SelectItem>
              <SelectItem value="faible">Faible (présence sous-développée)</SelectItem>
              <SelectItem value="tous">Tous</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Prospects / jour</Label>
          <Input
            type="number"
            min="1"
            max="20"
            value={form.prospectsPerDay}
            onChange={(e) => set('prospectsPerDay', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Offre proposée à ce segment</Label>
        <Input
          value={form.offer}
          onChange={(e) => set('offer', e.target.value)}
          className="h-8 text-sm"
          placeholder="Refonte communication, Campagne thématique..."
        />
      </div>

      <div>
        <Label className="text-xs">Brief campagne — en une phrase</Label>
        <Input
          value={form.campaignBrief}
          onChange={(e) => set('campaignBrief', e.target.value)}
          className="h-8 text-sm"
          placeholder="Ce que tu proposes à ce segment, en une phrase."
        />
      </div>

      <div>
        <Label className="text-xs">Angle de message</Label>
        <Input
          value={form.messageAngle}
          onChange={(e) => set('messageAngle', e.target.value)}
          className="h-8 text-sm"
          placeholder="Angle unique d'approche pour cette campagne..."
        />
      </div>

      <div>
        <Label className="text-xs">Signaux d'achat à rechercher</Label>
        <Textarea
          value={form.buyingSignals}
          onChange={(e) => set('buyingSignals', e.target.value)}
          className="text-sm min-h-[80px]"
          placeholder="Ex: Ouverture d'un nouveau point de vente, lancement d'une collection, anniversaire 10 ans, recrutement communication en cours..."
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" size="sm" disabled={createCampaign.isPending}>
          {createCampaign.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Créer la campagne
        </Button>
      </div>
    </form>
  );
}
