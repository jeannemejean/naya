// Accueil Outreach — shell de page + barre d'accès prospection + onglets Campagnes / Pipeline.
// L'onglet Campagnes affiche CampaignsGrid (Task 3) ; le corps de l'onglet Pipeline reste un
// placeholder, remplacé par PipelineBoard (Task 8).
import { useTranslation } from 'react-i18next';
import Sidebar from '@/components/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProspectionStatus } from './useOutreach';
import ProspectionAccessBar from './dialogs/ProspectionAccessBar';
import CampaignsGrid from './CampaignsGrid';

interface OutreachHomeProps {
  onSearchClick?: () => void;
}

export default function OutreachHome({ onSearchClick }: OutreachHomeProps) {
  const { t } = useTranslation();
  const { data: prospectionStatus } = useProspectionStatus();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div
            className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }}
          />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('outreach.title')}</h1>
              <p className="text-sm text-muted-foreground mt-1">{t('outreach.subtitle')}</p>
            </div>
          </div>
        </header>

        <ProspectionAccessBar status={prospectionStatus} />

        {/* Entry tabs */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="campaigns" className="flex-1 overflow-hidden flex flex-col">
            <div className="border-b border-border bg-white px-6 flex-shrink-0">
              <TabsList className="bg-transparent h-auto p-0 gap-1">
                <TabsTrigger
                  value="campaigns"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  Campagnes
                </TabsTrigger>
                <TabsTrigger
                  value="pipeline"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  Pipeline
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="campaigns" className="flex-1 overflow-y-auto m-0">
              <CampaignsGrid />
            </TabsContent>

            <TabsContent value="pipeline" className="flex-1 overflow-hidden m-0">
              <div className="p-6 text-muted-foreground">Pipeline — à venir (Task 8).</div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
