// Carte de prospect (kanban) — refonte de l'ancien LeadCard (git show 80a5a90:client/src/pages/
// outreach.tsx ~579-656). Comportement de drag/sélection/enrichissement inchangé ; nouveauté :
// hint canal + étape (voir NOTE data-limitation plus bas).
import { Loader2, Sparkles } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { campaignBadgeStyle, shortCampaignName } from '@/lib/campaign-color';
import { channelMeta, type ChannelId } from './channels';
import { STAGE_MAP, type StageKey } from './stages';
import type { Lead } from '@shared/schema';

const SCORE_LABEL: Record<string, string> = { hot: 'Chaud', warm: 'Tiède', cold: 'Froid' };
const SCORE_VARIANT: Record<string, 'mauve' | 'sulphur' | 'salvia'> = {
  hot: 'mauve',
  warm: 'sulphur',
  cold: 'salvia',
};

/** Canal principal d'une campagne — même dépliage que CampaignCard/CampaignWorkspace ('both' → linkedin en premier). */
function primaryChannel(channel: string | null | undefined): ChannelId {
  if (channel === 'email') return 'email';
  return 'linkedin';
}

interface LeadCardProps {
  lead: Lead;
  campaign?: { id: number; name: string; channel?: string | null };
  selected: boolean;
  onToggleSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  onEnrich: () => void;
  isEnriching: boolean;
}

export default function LeadCard({
  lead,
  campaign,
  selected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onClick,
  onEnrich,
  isEnriching,
}: LeadCardProps) {
  const hasMessages = !!((lead as any).linkedinMessage || (lead as any).emailMessage || (lead as any).message1);

  // Hint canal + progression — NOTE (data limitation, cf. rapport Task 8) : GET /api/leads ne
  // joint pas lead_sequence_state/campaign_sequence_steps, donc l'étape RÉELLE de séquence
  // ("2/4") n'est pas disponible sur le payload lead. On affiche donc le canal (dérivé de
  // campaign.channel) + le stage pipeline courant (lead.stage), qui EST disponible — pas
  // d'endpoint backend inventé pour combler l'écart.
  const stage = STAGE_MAP[((lead as any).stage as StageKey) || 'identified'];
  const channel = campaign ? channelMeta(primaryChannel(campaign.channel)) : null;
  const ChannelIcon = channel?.Icon;

  return (
    <Card
      className={`p-3 cursor-pointer group ${selected ? 'border-naya-mauve ring-1 ring-naya-mauve' : ''}`}
      lift={selected}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {/* Checkbox de sélection — stopPropagation pour ne pas ouvrir le détail ni déclencher le drag */}
        <span
          className="pt-0.5 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          draggable
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Sélectionner ${lead.name}`} />
        </span>
        <Avatar className="w-8 h-8 flex-shrink-0">
          <AvatarFallback className="text-[10px] bg-naya-mauve/20 text-naya-mauve font-medium">
            {lead.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{lead.name}</p>
          {lead.company && <p className="text-[10px] text-muted-foreground truncate">{lead.company}</p>}
          {(lead as any).role && <p className="text-[10px] text-muted-foreground truncate">{(lead as any).role}</p>}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-1 items-center min-w-0 flex-wrap">
          {/* Badge d'attribution de campagne — couleur déterministe dérivée de l'id */}
          {campaign && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium border max-w-[100px] truncate shrink-0"
              style={campaignBadgeStyle(campaign.id)}
              title={campaign.name}
            >
              {shortCampaignName(campaign.name)}
            </span>
          )}
          {SCORE_VARIANT[lead.score] && (
            <Badge variant={SCORE_VARIANT[lead.score]} className="px-1.5 py-0.5 text-[9px]">
              {SCORE_LABEL[lead.score]}
            </Badge>
          )}
          {hasMessages && (
            <Badge variant="mauve" className="px-1.5 py-0.5 text-[9px]">
              ✦ Prêt
            </Badge>
          )}
        </div>
        {!hasMessages && (
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-naya-mauve hover:text-naya-olive flex items-center gap-0.5 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onEnrich();
            }}
          >
            {isEnriching ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            Enrichir
          </button>
        )}
      </div>

      {/* NEW : hint canal + étape (approximation — voir NOTE ci-dessus) */}
      {channel && ChannelIcon && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground truncate">
          <ChannelIcon className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">
            {channel.label} · {stage.label}
          </span>
        </div>
      )}
    </Card>
  );
}
