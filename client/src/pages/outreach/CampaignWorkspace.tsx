// Espace de travail d'une campagne — coquille (Task 4) : Sidebar + header (nom + retour) +
// Tabs à 4 sous-onglets (Séquence, Prospects, Aperçu, Résultats). Chaque onglet est un
// placeholder ici, remplacé par les vraies vues dans les Tasks 5-9.
import { Link } from 'wouter';
import { ArrowLeft, Users } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCampaign, useLeads } from './useOutreach';
import { channelMeta, type ChannelId } from './channels';
import SequenceTab from './SequenceTab';
import PreviewTab from './PreviewTab';

interface CampaignWorkspaceProps {
  id: number;
  onSearchClick?: () => void;
}

/** Canaux distincts d'une campagne — `both` déplie en [linkedin, email] (cf. CampaignCard). */
function campaignChannels(channel: string | null | undefined): ChannelId[] {
  if (channel === 'both') return ['linkedin', 'email'];
  if (channel === 'email') return ['email'];
  return ['linkedin'];
}

export default function CampaignWorkspace({ id, onSearchClick }: CampaignWorkspaceProps) {
  const { data: campaign, isLoading } = useCampaign(id);
  const { data: leads } = useLeads();

  const prospectCount = (leads ?? []).filter(
    (lead: any) => lead.prospectionCampaignId === id && !lead.archivedAt,
  ).length;

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-border px-6 py-4 flex-shrink-0">
          <Link
            href="/outreach"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Prospection
          </Link>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : !campaign ? (
            <p className="text-sm text-muted-foreground">
              Campagne introuvable.{' '}
              <Link href="/outreach" className="text-primary hover:underline">
                Retour à la prospection
              </Link>
            </p>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{campaign.name}</h1>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex items-center gap-1.5">
                  {campaignChannels(campaign.channel).map((c) => {
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
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  {prospectCount} prospect{prospectCount > 1 ? 's' : ''}
                </span>
              </div>
            </>
          )}
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="sequence" className="flex-1 overflow-hidden flex flex-col">
            <div className="border-b border-border bg-white px-6 flex-shrink-0">
              <TabsList className="bg-transparent h-auto p-0 gap-1">
                <TabsTrigger
                  value="sequence"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  Séquence
                </TabsTrigger>
                <TabsTrigger
                  value="prospects"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  Prospects
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  Aperçu
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  Résultats
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="sequence" className="flex-1 overflow-y-auto m-0">
              <SequenceTab campaignId={id} />
            </TabsContent>

            <TabsContent value="prospects" className="flex-1 overflow-y-auto m-0">
              <div className="p-6 text-muted-foreground">Prospects — à venir (Task 6).</div>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 overflow-y-auto m-0">
              <PreviewTab campaignId={id} />
            </TabsContent>

            <TabsContent value="results" className="flex-1 overflow-y-auto m-0">
              <div className="p-6 text-muted-foreground">Résultats — à venir (Task 9).</div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
