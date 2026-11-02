// Onglet « Réponses » : liste des conversations (email + LinkedIn) et fil de la conversation ouverte.
import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Linkedin, Mail } from 'lucide-react';
import ConversationView from './ConversationView';
import { useReponsesListe } from './useReponses';
import { dateRelative } from './reponses-logique';

export default function ReponsesTab() {
  const { t, i18n } = useTranslation();
  const [, naviguer] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const idUrl = Number(params.get('conversation'));
  const ouverte = Number.isInteger(idUrl) && idUrl > 0 ? idUrl : null;
  const [statut, setStatut] = useState<'a_traiter' | 'traitee'>('a_traiter');
  const [projectId, setProjectId] = useState<number | null>(null);
  const { data: projets = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ['/api/projects'] });
  const { data: liste = [], isLoading, isError } = useReponsesListe(statut, projectId);
  const now = new Date();

  const choisir = (id: number | null) =>
    naviguer(`/outreach?onglet=reponses${id ? `&conversation=${id}` : ''}`, { replace: true });

  return (
    <div className="flex h-full overflow-hidden">
      <aside className={`${ouverte ? 'hidden lg:flex' : 'flex'} w-full lg:w-96 flex-col border-r border-border bg-white flex-shrink-0`}>
        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex gap-1">
            {(['a_traiter', 'traitee'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatut(s)}
                className={`px-3 py-1 text-xs rounded-full font-medium ${statut === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {s === 'a_traiter' ? t('outreach.reponses.aTraiter') : t('outreach.reponses.traitees')}
              </button>
            ))}
          </div>
          {projets.length > 1 && (
            <select aria-label={t('outreach.reponses.filtreProjet')} value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              className="w-full text-xs border border-border rounded-md px-2 py-1 bg-white">
              <option value="">{t('outreach.reponses.tousProjets')}</option>
              {projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">{t('outreach.reponses.chargement')}</p>}
          {isError && <p className="p-4 text-sm text-destructive">{t('outreach.reponses.erreurListe')}</p>}
          {!isLoading && !isError && liste.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t('outreach.reponses.vide')}</p>}
          <ul>
            {liste.map((c) => {
              const Icone = c.channel === 'linkedin' ? Linkedin : Mail;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => choisir(c.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/40 ${ouverte === c.id ? 'bg-primary/5' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Icone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className={`text-sm truncate ${c.nonLu ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>
                        {c.leadName}{c.company ? ` · ${c.company}` : ''}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground flex-shrink-0">{dateRelative(c.lastMessageAt, now, i18n.language)}</span>
                    </div>
                    {c.extrait && <p className={`text-xs mt-1 line-clamp-2 ${c.nonLu ? 'text-foreground' : 'text-muted-foreground'}`}>{c.extrait}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <section className={`${ouverte ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col`}>
        {ouverte
          ? <ConversationView key={ouverte} id={ouverte} onRetour={() => choisir(null)} onFermee={() => choisir(null)} />
          : <p className="p-6 text-sm text-muted-foreground">{t('outreach.reponses.choisir')}</p>}
      </section>
    </div>
  );
}
