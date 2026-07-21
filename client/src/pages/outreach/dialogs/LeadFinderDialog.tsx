// Lead Finder IA : l'IA définit le profil de prospect idéal (ICP) + les requêtes de sourcing —
// repris quasi-verbatim de l'ancien client/src/pages/outreach.tsx (LeadFinderDialog, git show
// 80a5a90 ~lignes 1563-1667). Campagne-scoped : à déclencher depuis l'espace de travail d'une
// campagne (onglet Prospects, non encore construit — voir task-9/task-10) ou CampaignsGrid ;
// non câblé par Task 8 (Pipeline global), qui n'a pas de campagne unique en contexte.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Loader2, Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface LeadFinderDialogProps {
  campaign: any;
  onClose: () => void;
}

export default function LeadFinderDialog({ campaign, onClose }: LeadFinderDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [icp, setIcp] = useState<any | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const fired = useRef(false);

  const find = useMutation({
    mutationFn: () => apiRequest('POST', `/api/prospection/campaigns/${campaign.id}/find-leads`).then((r) => r.json()),
    onSuccess: (res: any) => { setIcp(res.icp); setProviderConfigured(!!res.providerConfigured); },
    onError: () => toast({ title: 'Erreur', description: 'Génération impossible — réessaie.', variant: 'destructive' }),
  });

  const source = useMutation({
    mutationFn: () => apiRequest('POST', `/api/prospection/campaigns/${campaign.id}/source-leads`, { queries: icp?.googleQueries || [] }).then((r) => r.json()),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({ title: `${res.imported} prospect(s) importé(s)`, description: `${res.found} trouvé(s)${res.skipped ? `, ${res.skipped} déjà présent(s)` : ''}.` });
    },
    onError: () => toast({ title: 'Erreur', description: 'Sourcing impossible — réessaie.', variant: 'destructive' }),
  });

  useEffect(() => { if (!fired.current) { fired.current = true; find.mutate(); } }, []); // eslint-disable-line

  const Chips = ({ items }: { items?: string[] }) => (
    <div className="flex flex-wrap gap-1">
      {(items || []).map((x, i) => (
        <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-naya-olive-10 text-naya-olive">{x}</span>
      ))}
    </div>
  );
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      {children}
    </div>
  );
  const QueryList = ({ label, queries }: { label: string; queries?: string[] }) =>
    (queries && queries.length) ? (
      <Field label={label}>
        {queries.map((q, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <code className="text-[11px] bg-background border border-border rounded px-2 py-1 flex-1 break-all">{q}</code>
            <button onClick={() => { navigator.clipboard.writeText(q); toast({ title: 'Copié' }); }} className="text-muted-foreground hover:text-foreground shrink-0">
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </Field>
    ) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4" /> Prospects idéaux — {campaign.name}</DialogTitle>
        </DialogHeader>

        {find.isPending && (
          <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Naya analyse ta marque et l'objectif de campagne…
          </div>
        )}

        {icp && (
          <div className="space-y-4">
            {icp.rationale && <p className="text-xs text-foreground/80 italic bg-muted/40 rounded-lg px-3 py-2">{icp.rationale}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Intitulés de poste"><Chips items={icp.jobTitles} /></Field>
              <Field label="Séniorité"><Chips items={icp.seniority} /></Field>
              <Field label="Secteurs"><Chips items={icp.sectors} /></Field>
              <Field label="Taille d'entreprise"><span className="text-xs text-foreground/80">{icp.companySize || '—'}</span></Field>
              <Field label="Zones géographiques"><Chips items={icp.geographies} /></Field>
              <Field label="Mots-clés / signaux"><Chips items={icp.keywords} /></Field>
            </div>
            {icp.exclusions?.length > 0 && <Field label="À éviter"><Chips items={icp.exclusions} /></Field>}

            <div className="border-t border-border pt-3 space-y-3">
              <QueryList label="Requêtes LinkedIn (Sales Navigator)" queries={icp.linkedinQueries} />
              <QueryList label="Requêtes Google (X-ray)" queries={icp.googleQueries} />
            </div>

            <div className="text-[11px] text-muted-foreground bg-[rgba(212,201,122,0.15)] rounded-lg px-3 py-2">
              {providerConfigured
                ? "Source de données connectée : le sourcing automatique des prospects est disponible."
                : "Copie ces requêtes dans LinkedIn / Google pour trouver les prospects, puis ajoute-les via « Importer CSV ». (Le sourcing 100% automatique nécessite une source de données connectée.)"}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" disabled={find.isPending} onClick={() => find.mutate()}>Régénérer</Button>
              <div className="flex gap-2">
                {providerConfigured && (
                  <Button size="sm" disabled={source.isPending} onClick={() => source.mutate()} className="gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> {source.isPending ? 'Sourcing…' : 'Sourcer automatiquement'}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
