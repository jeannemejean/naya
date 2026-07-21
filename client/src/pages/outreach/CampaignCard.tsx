// Carte de campagne — remplace l'ancienne liste dense de CampaignsTab (voir git history,
// client/src/pages/outreach.tsx ~935-1200) par une carte cliquable qui navigue vers le nouvel
// espace de travail dédié /outreach/campaigns/:id.
import { Link } from 'wouter';
import { Users, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { channelMeta, type ChannelId } from './channels';

export interface CampaignLeadCount {
  /** Nombre total de prospects rattachés à cette campagne (hors archivés). */
  total: number;
  /** Prospects dont le message est prêt (stage === 'messages_ready'). */
  ready: number;
}

interface CampaignCardProps {
  campaign: any;
  leadCount: CampaignLeadCount;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'En pause',
  completed: 'Terminée',
};

const STATUS_VARIANT: Record<string, 'default' | 'sulphur' | 'outline'> = {
  active: 'default',
  paused: 'sulphur',
  completed: 'outline',
};

/** Canaux distincts d'une campagne — `both` déplie en [linkedin, email]. */
function campaignChannels(channel: string | null | undefined): ChannelId[] {
  if (channel === 'both') return ['linkedin', 'email'];
  if (channel === 'email') return ['email'];
  return ['linkedin'];
}

export default function CampaignCard({ campaign, leadCount }: CampaignCardProps) {
  const channels = campaignChannels(campaign.channel);
  const statusVariant = STATUS_VARIANT[campaign.status] ?? 'outline';
  const statusLabel = STATUS_LABEL[campaign.status] ?? campaign.status;

  return (
    <Link href={`/outreach/campaigns/${campaign.id}`}>
      <Card className="p-5 cursor-pointer hover:shadow-rest hover:border-naya-olive-18 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground leading-snug">{campaign.name}</h3>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {campaign.targetSector && <span>{campaign.targetSector}</span>}
          {campaign.offer && <span className="truncate">{campaign.offer}</span>}
        </div>

        <div className="flex items-center gap-1.5">
          {channels.map((c) => {
            const meta = channelMeta(c);
            const Icon = meta.Icon;
            return (
              <span
                key={c}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}
              >
                <Icon className="w-3 h-3" />
                {meta.label}
              </span>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-naya-olive-10 mt-1">
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            {leadCount.total} prospect{leadCount.total > 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {leadCount.ready} prêts / {leadCount.total} prospects
          </span>
        </div>
      </Card>
    </Link>
  );
}
