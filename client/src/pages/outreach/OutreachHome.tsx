// Accueil Outreach — shell de page + barre d'accès prospection + onglets Campagnes / Pipeline.
// L'onglet Campagnes affiche CampaignsGrid (Task 3) ; l'onglet Pipeline affiche PipelineBoard
// (Task 8, kanban repensé — canal + progression).
import { useTranslation } from 'react-i18next';
import Sidebar from '@/components/sidebar';
import OngletsEspace from '@/components/navigation/OngletsEspace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocation, useSearch } from 'wouter';
import { ongletDepuisRecherche } from '@/lib/lien-tache';
import { useProspectionStatus } from './useOutreach';
import { useReponsesCompte } from './useReponses';
import ReponsesTab from './ReponsesTab';
import ProspectionAccessBar from './dialogs/ProspectionAccessBar';
import CampaignsGrid from './CampaignsGrid';
import PipelineBoard from './PipelineBoard';

interface OutreachHomeProps {
  onSearchClick?: () => void;
}

export default function OutreachHome({ onSearchClick }: OutreachHomeProps) {
  const { t } = useTranslation();
  const { data: prospectionStatus } = useProspectionStatus();
  const { data: compte } = useReponsesCompte();
  const aTraiter = compte?.aTraiter ?? 0;
  const [, naviguer] = useLocation();
  const onglet = ongletDepuisRecherche(useSearch(), ['campaigns', 'pipeline', 'reponses'] as const, 'campaigns');

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <OngletsEspace />
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
          <Tabs value={onglet} onValueChange={(v) => naviguer(v === 'campaigns' ? '/outreach' : `/outreach?onglet=${v}`, { replace: true })} className="flex-1 overflow-hidden flex flex-col">
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
                <TabsTrigger
                  value="reponses"
                  className="px-4 py-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
                >
                  {t('outreach.reponses.onglet')}
                  {aTraiter > 0 && (
                    <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground" data-testid="pastille-reponses">
                      {aTraiter}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="campaigns" className="flex-1 min-h-0 overflow-y-auto m-0">
              <CampaignsGrid />
            </TabsContent>

            {/* `data-[state=inactive]:hidden` : la classe `flex` l'emporte sur l'attribut `hidden` que
                Radix pose sur un onglet inactif — sans elle, le panneau vide reste dans la colonne
                et repousse l'onglet affiché vers le bas. */}
            <TabsContent value="pipeline" className="flex-1 min-h-0 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden">
              <PipelineBoard />
            </TabsContent>

            <TabsContent value="reponses" className="flex-1 min-h-0 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden">
              <ReponsesTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
