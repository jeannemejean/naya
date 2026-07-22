// Formulaire d'ajout manuel d'un prospect — repris quasi-verbatim de l'ancien
// client/src/pages/outreach.tsx (AddLeadForm, git show 80a5a90 ~lignes 1204-1304).
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

interface AddLeadFormProps {
  campaigns: any[];
  onClose: () => void;
  /** Pré-sélectionne la campagne (ex: ouverture depuis ProspectsTab, scoped à une campagne). */
  defaultCampaignId?: number;
}

export default function AddLeadForm({ campaigns, onClose, defaultCampaignId }: AddLeadFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', company: '', role: '', sector: '',
    email: '', linkedinUrl: '', instagramUrl: '',
    score: 'cold', stage: 'identified',
    prospectionCampaignId: defaultCampaignId ? String(defaultCampaignId) : 'none', notes: '',
  });

  const addLead = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/leads', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({ title: 'Prospect ajouté' });
      onClose();
    },
    onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    addLead.mutate({
      ...form,
      prospectionCampaignId: form.prospectionCampaignId === 'none' ? null : Number(form.prospectionCampaignId),
    });
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nom *</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-sm" required />
        </div>
        <div>
          <Label className="text-xs">Entreprise</Label>
          <Input value={form.company} onChange={(e) => set('company', e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Rôle / Titre</Label>
          <Input value={form.role} onChange={(e) => set('role', e.target.value)} className="h-8 text-sm" placeholder="Fondatrice, CEO..." />
        </div>
        <div>
          <Label className="text-xs">Secteur</Label>
          <Input value={form.sector} onChange={(e) => set('sector', e.target.value)} className="h-8 text-sm" placeholder="Mode, Tourisme..." />
        </div>
        <div>
          <Label className="text-xs">LinkedIn URL</Label>
          <Input value={form.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} className="h-8 text-sm" placeholder="https://linkedin.com/in/..." />
        </div>
        <div>
          <Label className="text-xs">Instagram URL</Label>
          <Input value={form.instagramUrl} onChange={(e) => set('instagramUrl', e.target.value)} className="h-8 text-sm" placeholder="https://instagram.com/..." />
        </div>
        <div>
          <Label className="text-xs">Email</Label>
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Score</Label>
          <Select value={form.score} onValueChange={(v) => set('score', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hot">◆ Chaud</SelectItem>
              <SelectItem value="warm">◑ Tiède</SelectItem>
              <SelectItem value="cold">○ Froid</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Campagne de prospection</Label>
        <Select value={form.prospectionCampaignId} onValueChange={(v) => set('prospectionCampaignId', v)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Aucune campagne" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Aucune campagne</SelectItem>
            {campaigns.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Notes brutes</Label>
        <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="text-sm min-h-[60px]" placeholder="Signaux d'achat détectés, contexte..." />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>Annuler</Button>
        <Button type="submit" size="sm" disabled={addLead.isPending}>
          {addLead.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Ajouter
        </Button>
      </div>
    </form>
  );
}
