import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Sidebar from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Plus, Search, Copy, Sparkles, ExternalLink, CheckCircle2,
  Users, TrendingUp, Target, Zap, ChevronRight, Loader2,
  Instagram, Linkedin,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Lead } from '@shared/schema';

interface OutreachProps { onSearchClick?: () => void; }

// ─── Pipeline prospection (9 étapes SKILL.md) ────────────────────────────────

const STAGES = [
  { key: 'identified',      label: 'Identifié',           color: '#94a3b8', bg: 'bg-slate-100 dark:bg-slate-800' },
  { key: 'messages_ready',  label: 'Messages prêts',       color: '#6366f1', bg: 'bg-violet-50 dark:bg-violet-950/40' },
  { key: 'connection_sent', label: 'Connexion envoyée',    color: '#3b82f6', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  { key: 'connected',       label: 'Connecté',             color: '#06b6d4', bg: 'bg-cyan-50 dark:bg-cyan-950/40' },
  { key: 'followup1_sent',  label: 'Suivi 1 envoyé',       color: '#f59e0b', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  { key: 'followup2_sent',  label: 'Suivi 2 envoyé',       color: '#f97316', bg: 'bg-orange-50 dark:bg-orange-950/40' },
  { key: 'in_discussion',   label: 'En discussion',        color: '#8b5cf6', bg: 'bg-purple-50 dark:bg-purple-950/40' },
  { key: 'proposal_sent',   label: 'Proposition',          color: '#ec4899', bg: 'bg-pink-50 dark:bg-pink-950/40' },
  { key: 'signed',          label: 'Signé ✅',             color: '#10b981', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  { key: 'no_follow',       label: 'Sans suite',           color: '#475569', bg: 'bg-slate-100 dark:bg-slate-800/40' },
] as const;
type StageKey = typeof STAGES[number]['key'];

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.key, s])) as Record<StageKey, typeof STAGES[number]>;

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Outreach({ onSearchClick }: OutreachProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'campaigns'>('pipeline');
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [addCampaignOpen, setAddCampaignOpen] = useState(false);

  const { data: leads = [], isLoading: leadsLoading } = useQuery<Lead[]>({ queryKey: ['/api/leads'] });
  const { data: campaigns = [] } = useQuery<any[]>({ queryKey: ['/api/prospection/campaigns'] });

  const updateLeadMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<Lead> }) =>
      apiRequest('PATCH', `/api/leads/${id}`, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/leads'] }),
    onError: () => toast({ title: t('common.error'), variant: 'destructive' }),
  });

  const enrichMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/leads/${id}/enrich`).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      setSelectedLead(data);
      toast({ title: '✦ Enrichissement terminé', description: 'Audit + 3 messages générés par Naya.' });
    },
    onError: () => toast({ title: t('common.error'), description: 'Impossible de générer le contenu.', variant: 'destructive' }),
  });

  // Filter
  const filtered = leads.filter(l => {
    const matchSearch = !searchTerm ||
      l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.company || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchCampaign = campaignFilter === 'all' ||
      String((l as any).prospectionCampaignId) === campaignFilter;
    return matchSearch && matchCampaign;
  });

  // Group by stage
  const byStage = STAGES.reduce((acc, s) => {
    acc[s.key] = filtered.filter(l => (l as any).stage === s.key || (!( l as any).stage && s.key === 'identified'));
    return acc;
  }, {} as Record<StageKey, Lead[]>);

  // Metrics
  const total = leads.length;
  const withMessages = leads.filter(l => (l as any).message1).length;
  const inDiscussion = leads.filter(l => ['in_discussion', 'proposal_sent'].includes((l as any).stage)).length;
  const signed = leads.filter(l => (l as any).stage === 'signed').length;

  const handleDrop = (stageKey: StageKey) => {
    if (draggedLead && (draggedLead as any).stage !== stageKey) {
      updateLeadMutation.mutate({ id: draggedLead.id, updates: { stage: stageKey } as any });
    }
    setDraggedLead(null);
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('outreach.title')}</h1>
              <p className="text-sm text-muted-foreground mt-1">{t('outreach.subtitle')}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddCampaignOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Campagne
              </Button>
              <Button size="sm" onClick={() => setAddLeadOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Prospect
              </Button>
            </div>
          </div>
        </header>

        {/* Metrics strip */}
        <div className="border-b border-border px-6 py-3 flex gap-6 bg-white dark:bg-card flex-shrink-0">
          <Metric icon={<Users className="w-4 h-4" />} label="Prospects" value={total} color="text-violet-600" />
          <Metric icon={<Sparkles className="w-4 h-4" />} label="Messages prêts" value={withMessages} color="text-blue-600" />
          <Metric icon={<TrendingUp className="w-4 h-4" />} label="En discussion" value={inDiscussion} color="text-amber-600" />
          <Metric icon={<CheckCircle2 className="w-4 h-4" />} label="Signés" value={signed} color="text-emerald-600" />
          <Metric icon={<Target className="w-4 h-4" />} label="Campagnes actives" value={campaigns.filter((c: any) => c.status === 'active').length} color="text-rose-600" />
        </div>

        {/* Tabs */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="border-b border-border bg-white dark:bg-card px-6 flex-shrink-0">
            <div className="flex gap-1">
              {(['pipeline', 'campaigns'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'pipeline' ? 'Pipeline' : 'Campagnes'}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'pipeline' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Filters */}
              <div className="px-6 py-3 border-b border-border bg-background/50 flex gap-3 flex-shrink-0">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Chercher un prospect..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 h-8 text-sm"
                  />
                </div>
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                  <SelectTrigger className="w-48 h-8 text-sm">
                    <SelectValue placeholder="Toutes les campagnes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les campagnes</SelectItem>
                    {campaigns.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Kanban */}
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div className="flex gap-3 h-full p-4 w-max">
                  {STAGES.map(stage => (
                    <div
                      key={stage.key}
                      className={`w-52 flex flex-col rounded-xl border border-border ${stage.bg} flex-shrink-0`}
                      onDragOver={e => e.preventDefault()}
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
                        {byStage[stage.key]?.map(lead => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onDragStart={() => setDraggedLead(lead)}
                            onDragEnd={() => setDraggedLead(null)}
                            onClick={() => setSelectedLead(lead)}
                            onEnrich={() => enrichMutation.mutate(lead.id)}
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
            </div>
          )}

          {activeTab === 'campaigns' && (
            <div className="flex-1 overflow-y-auto p-6">
              <CampaignsTab campaigns={campaigns} leads={leads} />
            </div>
          )}
        </div>
      </div>

      {/* Lead Detail Sheet */}
      <Sheet open={!!selectedLead} onOpenChange={open => !open && setSelectedLead(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedLead && (
            <LeadDetail
              lead={selectedLead}
              campaigns={campaigns}
              onUpdate={(updates) => {
                updateLeadMutation.mutate({ id: selectedLead.id, updates });
                setSelectedLead({ ...selectedLead, ...updates } as Lead);
              }}
              onEnrich={() => enrichMutation.mutate(selectedLead.id)}
              isEnriching={enrichMutation.isPending}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Add Lead Dialog */}
      <Dialog open={addLeadOpen} onOpenChange={setAddLeadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Ajouter un prospect</DialogTitle></DialogHeader>
          <AddLeadForm
            campaigns={campaigns}
            onClose={() => setAddLeadOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Add Campaign Dialog */}
      <Dialog open={addCampaignOpen} onOpenChange={setAddCampaignOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Nouvelle campagne de prospection</DialogTitle></DialogHeader>
          <CampaignForm onClose={() => setAddCampaignOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Metric Strip ─────────────────────────────────────────────────────────────

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={color}>{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground leading-none">{value}</p>
      </div>
    </div>
  );
}

// ─── Lead Card (Kanban) ───────────────────────────────────────────────────────

function LeadCard({ lead, onDragStart, onDragEnd, onClick, onEnrich, isEnriching }: {
  lead: Lead;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  onEnrich: () => void;
  isEnriching: boolean;
}) {
  const hasMessages = !!(lead as any).message1;

  return (
    <div
      className="bg-white dark:bg-card rounded-lg border border-border p-3 cursor-pointer hover:shadow-md transition-all group"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <Avatar className="w-8 h-8 flex-shrink-0">
          <AvatarFallback className="text-[10px] bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 font-bold">
            {lead.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{lead.name}</p>
          {lead.company && (
            <p className="text-[10px] text-muted-foreground truncate">{lead.company}</p>
          )}
          {(lead as any).role && (
            <p className="text-[10px] text-muted-foreground truncate">{(lead as any).role}</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-1">
          {lead.score === 'hot' && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">Chaud</span>}
          {lead.score === 'warm' && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Tiède</span>}
          {lead.score === 'cold' && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Froid</span>}
          {hasMessages && <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">✦ Prêt</span>}
        </div>
        {!hasMessages && (
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-violet-600 hover:text-violet-800 flex items-center gap-0.5"
            onClick={e => { e.stopPropagation(); onEnrich(); }}
          >
            {isEnriching ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            Enrichir
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Lead Detail Sheet ────────────────────────────────────────────────────────

function LeadDetail({ lead, campaigns, onUpdate, onEnrich, isEnriching }: {
  lead: Lead;
  campaigns: any[];
  onUpdate: (updates: Partial<Lead>) => void;
  onEnrich: () => void;
  isEnriching: boolean;
}) {
  const { toast } = useToast();
  const hasAudit = !!(lead as any).strategicNotes;
  const hasMessages = !!(lead as any).message1;

  let audit: Record<string, string> = {};
  if (hasAudit) {
    try { audit = JSON.parse((lead as any).strategicNotes); } catch { /* ignore */ }
  }

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copié ✅` });
  };

  const currentStage = STAGE_MAP[(lead as any).stage as StageKey] || STAGE_MAP.identified;

  return (
    <div className="space-y-4">
      <SheetHeader>
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-sm">
              {lead.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <SheetTitle className="text-xl">{lead.name}</SheetTitle>
            {lead.company && <p className="text-sm text-muted-foreground">{lead.company}</p>}
            {(lead as any).role && <p className="text-xs text-muted-foreground">{(lead as any).role}</p>}
          </div>
          <div className="flex gap-1.5">
            {(lead as any).linkedinUrl && (
              <a href={(lead as any).linkedinUrl} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                <Linkedin className="w-4 h-4" />
              </a>
            )}
            {(lead as any).instagramUrl && (
              <a href={(lead as any).instagramUrl} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg bg-pink-50 text-pink-600 hover:bg-pink-100 transition-colors">
                <Instagram className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </SheetHeader>

      {/* Stage selector */}
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: currentStage.color }} />
        <Select value={(lead as any).stage || 'identified'} onValueChange={v => onUpdate({ stage: v } as any)}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map(s => (
              <SelectItem key={s.key} value={s.key}>
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!hasMessages && (
          <Button size="sm" className="h-8 text-xs gap-1 bg-violet-600 hover:bg-violet-700" onClick={onEnrich} disabled={isEnriching}>
            {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Enrichir avec Naya
          </Button>
        )}
        {hasMessages && (
          <Badge className="h-8 px-3 bg-violet-100 text-violet-700 border-0 text-xs">✦ Enrichi</Badge>
        )}
      </div>

      <Tabs defaultValue={hasAudit ? 'audit' : 'info'}>
        <TabsList className="grid grid-cols-3 h-8">
          <TabsTrigger value="info" className="text-xs">Infos</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs">Audit {!hasAudit && '○'}</TabsTrigger>
          <TabsTrigger value="messages" className="text-xs">Messages {!hasMessages && '○'}</TabsTrigger>
        </TabsList>

        {/* Infos tab */}
        <TabsContent value="info" className="space-y-3 mt-4">
          <div className="grid grid-cols-2 gap-3">
            <InfoField label="Secteur" value={(lead as any).sector} onChange={v => onUpdate({ sector: v } as any)} />
            <InfoField label="Score" value={lead.score}>
              <Select value={lead.score} onValueChange={v => onUpdate({ score: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">🔴 Chaud</SelectItem>
                  <SelectItem value="warm">🟡 Tiède</SelectItem>
                  <SelectItem value="cold">🔵 Froid</SelectItem>
                </SelectContent>
              </Select>
            </InfoField>
            <InfoField label="Email" value={lead.email || ''} onChange={v => onUpdate({ email: v })} />
            <InfoField label="LinkedIn URL" value={(lead as any).linkedinUrl || ''} onChange={v => onUpdate({ linkedinUrl: v } as any)} />
            <InfoField label="Instagram URL" value={(lead as any).instagramUrl || ''} onChange={v => onUpdate({ instagramUrl: v } as any)} />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Campagne associée</Label>
            <Select
              value={String((lead as any).prospectionCampaignId || 'none')}
              onValueChange={v => onUpdate({ prospectionCampaignId: v === 'none' ? null : Number(v) } as any)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Aucune campagne" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune campagne</SelectItem>
                {campaigns.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
            <Textarea
              value={lead.notes || ''}
              onChange={e => onUpdate({ notes: e.target.value })}
              className="text-sm min-h-[80px]"
              placeholder="Notes brutes sur ce prospect..."
            />
          </div>
        </TabsContent>

        {/* Audit tab */}
        <TabsContent value="audit" className="mt-4">
          {!hasAudit ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-12 h-12 bg-violet-50 dark:bg-violet-950/40 rounded-2xl flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6 text-violet-500" />
              </div>
              <p className="text-sm font-medium text-foreground">Audit de marque non généré</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Clique sur "Enrichir avec Naya" pour que Naya génère un audit structuré en 6 sections + les 3 messages.
              </p>
              <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700" onClick={onEnrich} disabled={isEnriching}>
                {isEnriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Enrichir avec Naya
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {[
                { key: 'contexteMarque', label: '1. Contexte marque', emoji: '🏷️' },
                { key: 'audience', label: '2. Audience', emoji: '👥' },
                { key: 'contenu', label: '3. Contenu & présence', emoji: '📱' },
                { key: 'positionnement', label: '4. Positionnement', emoji: '🎯' },
                { key: 'enjeux', label: '5. Enjeux identifiés', emoji: '⚡' },
                { key: 'angle', label: '6. Notre angle', emoji: '✦' },
              ].map(({ key, label, emoji }) => (
                <div key={key} className="bg-muted/40 rounded-xl p-4">
                  <p className="text-xs font-semibold text-foreground mb-1.5">{emoji} {label}</p>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {audit[key] || '—'}
                  </p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground text-center">
                Enrichi le {(lead as any).enrichedAt
                  ? new Date((lead as any).enrichedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
                  : '—'}
              </p>
            </div>
          )}
        </TabsContent>

        {/* Messages tab */}
        <TabsContent value="messages" className="mt-4">
          {!hasMessages ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-12 h-12 bg-blue-50 dark:bg-blue-950/40 rounded-2xl flex items-center justify-center mx-auto">
                <Zap className="w-6 h-6 text-blue-500" />
              </div>
              <p className="text-sm font-medium text-foreground">Messages non générés</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Lance l'enrichissement pour obtenir les 3 messages personnalisés.
              </p>
              <Button size="sm" className="gap-1.5" onClick={onEnrich} disabled={isEnriching}>
                {isEnriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Générer les messages
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {[
                { key: 'message1', label: 'Message 1 — Connexion LinkedIn', badge: '≤200 cars', color: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' },
                { key: 'message2', label: 'Message 2 — Suivi après connexion', badge: '5-8 phrases', color: 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800' },
                { key: 'message3', label: 'Message 3 — Clôture', badge: '2-3 phrases', color: 'bg-slate-50 dark:bg-slate-800/50 border-border' },
              ].map(({ key, label, badge, color }) => (
                <div key={key} className={`rounded-xl border p-4 ${color}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-foreground">{label}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{badge}</span>
                      <button
                        onClick={() => copy((lead as any)[key], label)}
                        className="p-1.5 rounded-lg hover:bg-background/60 transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {(lead as any)[key]}
                  </p>
                  {key === 'message1' && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      {(lead as any)[key]?.length || 0} / 200 caractères
                    </p>
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs"
                onClick={onEnrich}
                disabled={isEnriching}
              >
                {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Régénérer les messages
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Info Field Helper ────────────────────────────────────────────────────────

function InfoField({ label, value, onChange, children }: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      {children || (
        <Input
          value={value || ''}
          onChange={e => onChange?.(e.target.value)}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────

function CampaignsTab({ campaigns, leads }: { campaigns: any[]; leads: Lead[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingCampaign, setEditingCampaign] = useState<any | null>(null);
  const [searchBrief, setSearchBrief] = useState<{ id: number; brief: any } | null>(null);
  const [loadingBrief, setLoadingBrief] = useState<number | null>(null);

  const updateCampaign = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) =>
      apiRequest('PATCH', `/api/prospection/campaigns/${id}`, updates).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/prospection/campaigns'] }),
  });

  const deleteCampaign = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/prospection/campaigns/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/prospection/campaigns'] }),
  });

  const generateBrief = async (id: number) => {
    setLoadingBrief(id);
    try {
      const r = await apiRequest('POST', `/api/prospection/campaigns/${id}/search-brief`);
      const data = await r.json();
      setSearchBrief({ id, brief: data });
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de générer le brief.', variant: 'destructive' });
    } finally {
      setLoadingBrief(null);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-20 space-y-3">
        <div className="w-14 h-14 bg-violet-50 dark:bg-violet-950/40 rounded-2xl flex items-center justify-center mx-auto">
          <Target className="w-7 h-7 text-violet-500" />
        </div>
        <p className="text-sm font-medium text-foreground">Aucune campagne de prospection</p>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          Crée ta première campagne pour structurer ta prospection par secteur, canal et signal d'achat.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {campaigns.map((campaign: any) => {
        const campaignLeads = leads.filter(l => (l as any).prospectionCampaignId === campaign.id);
        const withMessages = campaignLeads.filter(l => (l as any).message1).length;
        const inDiscussion = campaignLeads.filter(l => ['in_discussion', 'proposal_sent', 'signed'].includes((l as any).stage)).length;
        const statusColor = campaign.status === 'active' ? 'bg-emerald-100 text-emerald-700' : campaign.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';

        return (
          <div key={campaign.id} className="bg-white dark:bg-card rounded-2xl border border-border p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{campaign.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
                    {campaign.status === 'active' ? 'Active' : campaign.status === 'paused' ? 'En pause' : 'Terminée'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {campaign.targetSector && <span>📍 {campaign.targetSector}</span>}
                  {campaign.channel && <span>📡 {campaign.channel === 'linkedin' ? 'LinkedIn' : campaign.channel === 'email' ? 'Email' : 'LinkedIn + Email'}</span>}
                  {campaign.digitalLevel && <span>💻 Digital {campaign.digitalLevel}</span>}
                  {campaign.prospectsPerDay && <span>🎯 {campaign.prospectsPerDay} prospects/jour</span>}
                </div>
              </div>
              <div className="flex gap-1.5 ml-3">
                <Select
                  value={campaign.status}
                  onValueChange={v => updateCampaign.mutate({ id: campaign.id, updates: { status: v } })}
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">En pause</SelectItem>
                    <SelectItem value="completed">Terminée</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Campagne marketing liée */}
            {(campaign as any).linkedCampaignId && (
              <div className="flex items-center gap-2 mb-3 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg border border-indigo-200 dark:border-indigo-800/40">
                <span className="text-xs">📣</span>
                <p className="text-[11px] text-indigo-700 dark:text-indigo-400 flex-1">Campagne marketing liée</p>
                <a href="/campaigns" className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0">Voir →</a>
              </div>
            )}

            {/* Brief */}
            {campaign.campaignBrief && (
              <p className="text-xs text-foreground/70 italic bg-muted/40 rounded-lg px-3 py-2 mb-3">
                "{campaign.campaignBrief}"
              </p>
            )}

            {/* Buying signals */}
            {campaign.buyingSignals && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Signaux d'achat</p>
                <p className="text-xs text-foreground/70">{campaign.buyingSignals}</p>
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{campaignLeads.length}</p>
                <p className="text-[10px] text-muted-foreground">Prospects</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-violet-600">{withMessages}</p>
                <p className="text-[10px] text-muted-foreground">Messages prêts</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-600">{inDiscussion}</p>
                <p className="text-[10px] text-muted-foreground">En discussion</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 gap-1.5"
                onClick={() => generateBrief(campaign.id)}
                disabled={loadingBrief === campaign.id}
              >
                {loadingBrief === campaign.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                Générer brief de recherche
              </Button>
            </div>

            {/* Search brief result */}
            {(() => {
              const activeBrief = searchBrief;
              if (!activeBrief || activeBrief.id !== campaign.id) return null;
              const b = activeBrief.brief;
              return (
                <div className="mt-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Brief de recherche généré</p>
                  {b.criteria && <p className="text-xs text-foreground/80">{b.criteria}</p>}
                  {b.linkedinQueries?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Requêtes LinkedIn</p>
                      {b.linkedinQueries.map((q: string, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <code className="text-xs bg-background/80 px-2 py-0.5 rounded border border-border flex-1">{q}</code>
                          <button onClick={() => navigator.clipboard.writeText(q)} className="text-muted-foreground hover:text-foreground">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {b.webQueries?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Requêtes Web</p>
                      {b.webQueries.map((q: string, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <code className="text-xs bg-background/80 px-2 py-0.5 rounded border border-border flex-1">{q}</code>
                          <button onClick={() => navigator.clipboard.writeText(q)} className="text-muted-foreground hover:text-foreground">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// ─── Add Lead Form ────────────────────────────────────────────────────────────

function AddLeadForm({ campaigns, onClose }: { campaigns: any[]; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', company: '', role: '', sector: '',
    email: '', linkedinUrl: '', instagramUrl: '',
    score: 'cold', stage: 'identified',
    prospectionCampaignId: 'none', notes: '',
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

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nom *</Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)} className="h-8 text-sm" required />
        </div>
        <div>
          <Label className="text-xs">Entreprise</Label>
          <Input value={form.company} onChange={e => set('company', e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Rôle / Titre</Label>
          <Input value={form.role} onChange={e => set('role', e.target.value)} className="h-8 text-sm" placeholder="Fondatrice, CEO..." />
        </div>
        <div>
          <Label className="text-xs">Secteur</Label>
          <Input value={form.sector} onChange={e => set('sector', e.target.value)} className="h-8 text-sm" placeholder="Mode, Tourisme..." />
        </div>
        <div>
          <Label className="text-xs">LinkedIn URL</Label>
          <Input value={form.linkedinUrl} onChange={e => set('linkedinUrl', e.target.value)} className="h-8 text-sm" placeholder="https://linkedin.com/in/..." />
        </div>
        <div>
          <Label className="text-xs">Instagram URL</Label>
          <Input value={form.instagramUrl} onChange={e => set('instagramUrl', e.target.value)} className="h-8 text-sm" placeholder="https://instagram.com/..." />
        </div>
        <div>
          <Label className="text-xs">Email</Label>
          <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Score</Label>
          <Select value={form.score} onValueChange={v => set('score', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hot">🔴 Chaud</SelectItem>
              <SelectItem value="warm">🟡 Tiède</SelectItem>
              <SelectItem value="cold">🔵 Froid</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Campagne de prospection</Label>
        <Select value={form.prospectionCampaignId} onValueChange={v => set('prospectionCampaignId', v)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Aucune campagne" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Aucune campagne</SelectItem>
            {campaigns.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Notes brutes</Label>
        <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="text-sm min-h-[60px]" placeholder="Signaux d'achat détectés, contexte..." />
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

// ─── Campaign Form ────────────────────────────────────────────────────────────

function CampaignForm({ onClose, initial }: { onClose: () => void; initial?: any }) {
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
    mutationFn: (data: any) => apiRequest('POST', '/api/prospection/campaigns', data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prospection/campaigns'] });
      toast({ title: 'Campagne créée ✅' });
      onClose();
    },
    onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    createCampaign.mutate({ ...form, prospectsPerDay: Number(form.prospectsPerDay) });
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label className="text-xs">Nom de la campagne *</Label>
        <Input value={form.name} onChange={e => set('name', e.target.value)} className="h-8 text-sm" placeholder="Vignobles — Tourisme international" required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Secteur cible</Label>
          <Input value={form.targetSector} onChange={e => set('targetSector', e.target.value)} className="h-8 text-sm" placeholder="Viticulture, Oenotourisme..." />
        </div>
        <div>
          <Label className="text-xs">Canal</Label>
          <Select value={form.channel} onValueChange={v => set('channel', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="both">LinkedIn + Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Niveau digital</Label>
          <Select value={form.digitalLevel} onValueChange={v => set('digitalLevel', v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
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
            type="number" min="1" max="20"
            value={form.prospectsPerDay}
            onChange={e => set('prospectsPerDay', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Offre proposée à ce segment</Label>
        <Input value={form.offer} onChange={e => set('offer', e.target.value)} className="h-8 text-sm" placeholder="Refonte communication, Campagne thématique..." />
      </div>

      <div>
        <Label className="text-xs">Brief campagne — en une phrase</Label>
        <Input value={form.campaignBrief} onChange={e => set('campaignBrief', e.target.value)} className="h-8 text-sm" placeholder="Ce que tu proposes à ce segment, en une phrase." />
      </div>

      <div>
        <Label className="text-xs">Angle de message</Label>
        <Input value={form.messageAngle} onChange={e => set('messageAngle', e.target.value)} className="h-8 text-sm" placeholder="Angle unique d'approche pour cette campagne..." />
      </div>

      <div>
        <Label className="text-xs">Signaux d'achat à rechercher</Label>
        <Textarea
          value={form.buyingSignals}
          onChange={e => set('buyingSignals', e.target.value)}
          className="text-sm min-h-[80px]"
          placeholder="Ex: Ouverture d'un nouveau point de vente, lancement d'une collection, anniversaire 10 ans, recrutement communication en cours..."
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>Annuler</Button>
        <Button type="submit" size="sm" disabled={createCampaign.isPending}>
          {createCampaign.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Créer la campagne
        </Button>
      </div>
    </form>
  );
}
