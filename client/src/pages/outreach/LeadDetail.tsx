// Fiche prospect repensée — refonte de l'ancien LeadDetail monolithique (git show
// 80a5a90:client/src/pages/outreach.tsx ~672-931 : LeadDetail + InfoField) en 3 onglets
// Profil / Audit / Séquence. Remplace le LeadDetailStub temporaire posé par Task 8 dans
// PipelineBoard.tsx. Contrairement à l'ancien composant (piloté par le parent via des props
// `onUpdate`/`onEnrich`), celui-ci possède ses propres mutations (useUpdateLead, useEnrichLead)
// pour respecter l'interface cible `LeadDetail({ lead, open, onOpenChange })` — le parent n'a
// plus qu'à lui passer le prospect sélectionné et l'état d'ouverture du Sheet.
import { useEffect, useState } from 'react';
import {
  Copy, ExternalLink, Instagram, Linkedin, Loader2, Mail, Sparkles, type LucideIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type { Lead } from '@shared/schema';
import { useEnrichLead, useProspectionStatus, useUpdateLead } from './useOutreach';
import { STAGES, STAGE_MAP, type StageKey } from './stages';
import { channelMeta } from './channels';
import AuditView from './AuditView';

interface LeadDetailProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function LeadDetail({ lead, open, onOpenChange }: LeadDetailProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {lead && <LeadDetailBody lead={lead} />}
      </SheetContent>
    </Sheet>
  );
}

// ─── Corps de la fiche ──────────────────────────────────────────────────────────
// Séparé du Sheet lui-même pour garder un état local (`localLead`) qui reflète les mises à jour
// optimistes sans attendre le refetch de /api/leads — resynchronisé dès que le prop `lead` change
// (nouvel prospect ouvert, ou données fraîches revenues du serveur après invalidation).

function LeadDetailBody({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const [localLead, setLocalLead] = useState<Lead>(lead);
  useEffect(() => setLocalLead(lead), [lead]);

  const { data: prospectionStatus } = useProspectionStatus();
  const updateLeadMutation = useUpdateLead();
  const enrichMutation = useEnrichLead();
  const isEnriching = enrichMutation.isPending;

  const handleUpdate = (updates: Partial<Lead>) => {
    setLocalLead((prev) => ({ ...prev, ...updates }));
    updateLeadMutation.mutate(
      { id: lead.id, updates },
      { onError: () => toast({ title: 'Erreur', description: "Mise à jour impossible.", variant: 'destructive' }) },
    );
  };

  const handleEnrich = () => {
    enrichMutation.mutate(lead.id, {
      onSuccess: (data) => {
        setLocalLead(data);
        toast({ title: '✦ Enrichissement terminé', description: 'Profil analysé, audit et message générés par Naya.' });
      },
      onError: (e: any) => {
        // Erreurs de gate (403) : message clair renvoyé par l'API (plan / limite LinkedIn) —
        // comportement migré tel quel depuis l'ancien outreach.tsx.
        let msg = 'Impossible de générer le contenu.';
        const m = (e?.message || '').match(/\{[\s\S]*\}/);
        if (m) { try { msg = JSON.parse(m[0]).message || msg; } catch { /* ignore */ } }
        toast({ title: 'Enrichissement', description: msg, variant: 'destructive' });
      },
    });
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: `${label} copié` }))
      .catch(() => toast({ title: 'Erreur', description: 'Impossible de copier.', variant: 'destructive' }));
  };

  const l = localLead as any;
  const hasMessages = !!(l.linkedinMessage || l.emailMessage || l.message1);
  const currentStage = STAGE_MAP[(l.stage as StageKey)] || STAGE_MAP.identified;
  const enrichmentAvailable = prospectionStatus?.enrichment_available ?? false;

  const socialLinks: { key: string; href: string; Icon: LucideIcon; className: string }[] = [
    l.linkedinUrl && {
      key: 'linkedin', href: l.linkedinUrl, Icon: Linkedin,
      className: 'bg-naya-salvia/15 text-naya-salvia hover:bg-naya-salvia/25',
    },
    l.instagramUrl && {
      key: 'instagram', href: l.instagramUrl, Icon: Instagram,
      className: 'bg-naya-mauve/15 text-naya-mauve hover:bg-naya-mauve/25',
    },
    lead.email && {
      key: 'email', href: `mailto:${lead.email}`, Icon: Mail,
      className: 'bg-naya-sulphur/15 text-naya-olive hover:bg-naya-sulphur/25',
    },
    // Lien générique de profil (source discovery) — affiché seulement si aucune URL dédiée
    // (LinkedIn/Instagram) n'est déjà proposée, pour ne pas dupliquer le même lien.
    l.profileUrl && !l.linkedinUrl && !l.instagramUrl && {
      key: 'profile', href: l.profileUrl, Icon: ExternalLink,
      className: 'bg-naya-olive-10 text-naya-olive hover:bg-naya-olive-18',
    },
  ].filter(Boolean) as { key: string; href: string; Icon: LucideIcon; className: string }[];

  return (
    <div className="space-y-4">
      <SheetHeader>
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-naya-mauve/20 text-naya-mauve font-medium text-sm">
              {lead.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <SheetTitle className="text-xl">{lead.name}</SheetTitle>
            {(lead.company || l.role) && (
              <p className="text-sm text-muted-foreground truncate">
                {[lead.company, l.role].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          {socialLinks.length > 0 && (
            <div className="flex gap-1.5 flex-shrink-0">
              {socialLinks.map(({ key, href, Icon, className }) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`p-1.5 rounded-lg transition-colors ${className}`}
                  aria-label={key}
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          )}
        </div>
      </SheetHeader>

      <Tabs defaultValue="profil">
        <TabsList className="grid grid-cols-3 h-8">
          <TabsTrigger value="profil" className="text-xs">Profil</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs">Audit</TabsTrigger>
          <TabsTrigger value="sequence" className="text-xs">Séquence</TabsTrigger>
        </TabsList>

        {/* Profil */}
        <TabsContent value="profil" className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: currentStage.color }} />
            <Select value={(l.stage as StageKey) || 'identified'} onValueChange={(v) => handleUpdate({ stage: v } as Partial<Lead>)}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoField label="Entreprise" value={lead.company || ''} onChange={(v) => handleUpdate({ company: v })} />
            <InfoField label="Rôle" value={l.role || ''} onChange={(v) => handleUpdate({ role: v } as Partial<Lead>)} />
            <InfoField label="Secteur" value={l.sector || ''} onChange={(v) => handleUpdate({ sector: v } as Partial<Lead>)} />
          </div>

          <div className="pt-2 border-t border-naya-olive-10">
            {hasMessages ? (
              <div className="flex items-center justify-between gap-2">
                <Badge variant="mauve" className="h-8 px-3 text-xs">✦ Enrichi</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  onClick={handleEnrich}
                  disabled={isEnriching}
                >
                  {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Régénérer
                </Button>
              </div>
            ) : enrichmentAvailable ? (
              <Button
                size="sm"
                className="w-full h-8 text-xs gap-1 bg-primary text-primary-foreground hover:opacity-90"
                onClick={handleEnrich}
                disabled={isEnriching}
              >
                {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Enrichir (IA)
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                Active l'option <span className="font-medium text-foreground">Enrichissement</span> dans les réglages pour générer l'audit IA et les messages.
              </p>
            )}
          </div>
        </TabsContent>

        {/* Audit */}
        <TabsContent value="audit" className="mt-4">
          <AuditView auditNotes={l.auditNotes || l.strategicNotes} />
        </TabsContent>

        {/* Séquence */}
        <TabsContent value="sequence" className="mt-4">
          <SequenceTabContent lead={localLead} onCopy={copy} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Onglet Séquence ────────────────────────────────────────────────────────────
// Messages bespoke de CE prospect (linkedinMessage/emailMessage, ou message1/message2 en
// fallback legacy). GET /api/leads ne joint pas l'état par-étape de la séquence de campagne
// (lead_sequence_state) — pas d'endpoint inventé pour combler l'écart (cf. NOTE Task 8 dans
// LeadCard.tsx) : on affiche donc les messages disponibles + un renvoi vers l'aperçu de campagne.

function SequenceTabContent({ lead, onCopy }: { lead: Lead; onCopy: (text: string, label: string) => void }) {
  const l = lead as any;
  const messages = [
    { key: 'linkedin', channel: 'linkedin', value: l.linkedinMessage || l.message1, label: 'Message LinkedIn — Connexion' },
    { key: 'email', channel: 'email', value: l.emailMessage || l.message2, label: 'Email personnalisé' },
  ].filter((m) => m.value);

  if (messages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-10 max-w-xs mx-auto">
        Aucun message généré pour ce prospect. Lance « Enrichir (IA) » depuis l'onglet Profil.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map(({ key, channel, value, label }) => {
        const meta = channelMeta(channel);
        const Icon = meta.Icon;
        return (
          <div key={key} className="rounded-lg border border-naya-olive-18 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
                <Icon className="w-3 h-3" />
                {meta.label}
              </span>
              <button
                onClick={() => onCopy(value, label)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label={`Copier : ${label}`}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs font-medium text-foreground mb-1">{label}</p>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{value}</p>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground text-center pt-1">
        La séquence complète est visible dans l'aperçu de la campagne.
      </p>
    </div>
  );
}

// ─── Champ éditable inline ──────────────────────────────────────────────────────
// Adapté de l'ancien outreach.tsx (~913-931) : la sauvegarde (onChange, qui déclenche la
// mutation PATCH côté parent) ne part plus à CHAQUE frappe mais seulement à la perte de focus
// (onBlur) — le champ reste contrôlé et affiche la frappe en cours via un état local, resynchronisé
// si `value` change depuis l'extérieur (nouveau prospect ouvert, données rafraîchies).

function InfoField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="h-8 text-xs"
      />
    </div>
  );
}
