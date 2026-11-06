// Onglet « Réponses » : UNE boîte pour toutes les campagnes (chaque conversation porte
// l'étiquette de sa campagne, filtre campagne dans l'URL) et fil de la conversation ouverte.
import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Linkedin, Mail } from 'lucide-react';
import ConversationView from './ConversationView';
import EtiquetteCampagne from './EtiquetteCampagne';
import { useReponsesListe } from './useReponses';
import { useCampaigns } from './useOutreach';
import {
  campagneDepuisRecherche, campagnesDeListe, dateRelative, filtrerParCampagne, fusionnerCampagnes, urlReponses,
} from './reponses-logique';

const SELECT = 'min-w-0 flex-1 text-sm border border-border rounded-md px-2 py-1.5 bg-white text-foreground';

export default function ReponsesTab() {
  const { t, i18n } = useTranslation();
  const [, naviguer] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const idUrl = Number(params.get('conversation'));
  const ouverte = Number.isInteger(idUrl) && idUrl > 0 ? idUrl : null;
  const campagne = campagneDepuisRecherche(search);
  const [statut, setStatut] = useState<'a_traiter' | 'traitee'>('a_traiter');
  const [projectId, setProjectId] = useState<number | null>(null);
  const { data: projets = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ['/api/projects'] });
  const { data: campagnes = [] } = useCampaigns();
  const { data: toutes = [], isLoading, isError } = useReponsesListe(statut, projectId);
  const liste = filtrerParCampagne(toutes, campagne);
  const now = new Date();

  // Campagnes du filtre : celles de l'utilisateur (noms à jour) + celles vues dans la liste
  // (une campagne archivée ou supprimée dont des conversations restent doit rester filtrable).
  const options = fusionnerCampagnes(
    campagnes.map((c: any) => ({ id: Number(c.id), name: String(c.name ?? '') })),
    campagnesDeListe(toutes),
  );

  const aller = (o: { campagne?: number | null; conversation?: number | null }) =>
    naviguer(urlReponses({ campagne, conversation: ouverte, ...o }), { replace: true });

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">
      <aside className={`${ouverte ? 'hidden lg:flex' : 'flex'} w-full lg:w-96 min-h-0 flex-col border-r border-border bg-white flex-shrink-0`}>
        <div className="px-4 py-3 border-b border-border space-y-2 flex-shrink-0">
          <div className="flex gap-1">
            {(['a_traiter', 'traitee'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatut(s)}
                className={`px-3 py-1 text-xs rounded-full font-medium ${statut === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {s === 'a_traiter' ? t('outreach.reponses.aTraiter') : t('outreach.reponses.traitees')}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {projets.length > 1 && (
              <select aria-label={t('outreach.reponses.filtreProjet')} value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)} className={SELECT}>
                <option value="">{t('outreach.reponses.tousProjets')}</option>
                {projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {(options.length > 0 || campagne != null) && (
              <select aria-label={t('outreach.reponses.filtreCampagne')} value={campagne ?? ''}
                onChange={(e) => aller({ campagne: e.target.value ? Number(e.target.value) : null, conversation: null })}
                className={SELECT} data-testid="filtre-campagne">
                <option value="">{t('outreach.reponses.toutesCampagnes')}</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">{t('outreach.reponses.chargement')}</p>}
          {isError && <p className="p-4 text-sm text-destructive">{t('outreach.reponses.erreurListe')}</p>}
          {!isLoading && !isError && liste.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {campagne != null ? t('outreach.reponses.videCampagne') : t('outreach.reponses.vide')}
            </p>
          )}
          <ul>
            {liste.map((c) => {
              const Icone = c.channel === 'linkedin' ? Linkedin : Mail;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => aller({ conversation: c.id })}
                    className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/40 ${ouverte === c.id ? 'bg-primary/5' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Icone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className={`text-sm truncate ${c.nonLu ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>
                        {c.leadName}{c.company ? ` · ${c.company}` : ''}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground flex-shrink-0">{dateRelative(c.lastMessageAt, now, i18n.language)}</span>
                    </div>
                    {c.campaignId != null && (
                      <div className="mt-1.5 flex min-w-0">
                        <EtiquetteCampagne id={c.campaignId} nom={c.campaignName ?? ''} />
                      </div>
                    )}
                    {c.extrait && (
                      <p className={`text-sm mt-1.5 line-clamp-2 break-words [overflow-wrap:anywhere] ${c.nonLu ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {c.extrait}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <section className={`${ouverte ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 min-h-0 flex-col`}>
        {ouverte
          ? <ConversationView key={ouverte} id={ouverte} onRetour={() => aller({ conversation: null })} onFermee={() => aller({ conversation: null })} />
          : <p className="p-6 text-sm text-muted-foreground">{t('outreach.reponses.choisir')}</p>}
      </section>
    </div>
  );
}
