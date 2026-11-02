// Fil d'une conversation de la boîte « Réponses » : messages, fiche courte du prospect, zone de
// réponse (préremplie par « Proposer une réponse ») et actions. Rien ne part sans « Envoyer ».
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, Linkedin, Loader2, Mail, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  useConversation, useProposerReponse, useEnvoyerReponse, useMarquerTraitee, usePasUneReponse,
  type ConversationDetail,
} from './useReponses';
import { cleErreurEnvoi, cleErreurPasUneReponse, dateRelative, ordonnerFil, typeBulle } from './reponses-logique';

export function Fil({ messages }: { messages: ConversationDetail['messages'] }) {
  const { t, i18n } = useTranslation();
  const now = new Date();
  return (
    <div className="space-y-3" data-testid="fil-reponses">
      {ordonnerFil(messages).map((m) => {
        const type = typeBulle(m);
        const date = dateRelative(m.sentAt, now, i18n.language);
        if (type === 'discret') {
          return (
            <p key={m.id} className="text-xs text-muted-foreground text-center italic">
              {m.nature === 'absence' ? t('outreach.reponses.absence') : t('outreach.reponses.accuse')} · {date}
            </p>
          );
        }
        const sortant = type !== 'entrant';
        return (
          <div key={m.id} className={`flex ${sortant ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm border ${
              sortant ? 'bg-primary/5 border-primary/20' : 'bg-white border-border'
            } ${type === 'en_attente' ? 'opacity-60' : ''}`}>
              {m.subject && <p className="text-xs font-semibold text-foreground mb-1">{m.subject}</p>}
              <p className="whitespace-pre-wrap text-foreground">{m.body}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {type === 'en_attente' ? t('outreach.reponses.envoiEnCours') : date}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ConversationView({ id, onRetour, onFermee }: { id: number; onRetour: () => void; onFermee: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data, isLoading, isError } = useConversation(id);
  const proposer = useProposerReponse(id);
  const envoyer = useEnvoyerReponse(id);
  const traitee = useMarquerTraitee(id);
  const pasUne = usePasUneReponse(id);
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  if (isLoading) return <div className="p-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (isError || !data) {
    return (
      <div className="p-6 space-y-2">
        <Button variant="ghost" size="sm" onClick={onRetour}><ArrowLeft className="h-4 w-4 mr-1" />{t('outreach.reponses.retour')}</Button>
        <p className="text-sm text-destructive">{t('outreach.reponses.erreurConversation')}</p>
      </div>
    );
  }
  const { conversation, lead, campagne, messages } = data;
  const CanalIcone = conversation.channel === 'linkedin' ? Linkedin : Mail;

  const demanderProposition = () => {
    setErreur(null);
    proposer.mutate(undefined, {
      onSuccess: (r) => setTexte(r.texte),
      onError: (e) => setErreur(/^409/.test(e.message) ? t('outreach.reponses.proposerSignature') : t('outreach.reponses.proposerErreur')),
    });
  };
  const envoyerTexte = () => {
    setErreur(null);
    envoyer.mutate(texte, {
      onSuccess: (r) => {
        if (r.ok) { setTexte(''); toast({ title: t('outreach.reponses.envoyeOk') }); }
        else setErreur(t(cleErreurEnvoi(r.raison)));
      },
      onError: () => setErreur(t(cleErreurEnvoi('echec'))),
    });
  };
  const marquerTraitee = () => traitee.mutate(undefined, {
    onSuccess: () => { toast({ title: t('outreach.reponses.traiteeOk') }); onFermee(); },
    onError: () => setErreur(t('outreach.reponses.traiteeErreur')),
  });
  const pasUneVraie = () => pasUne.mutate(undefined, {
    onSuccess: (r) => {
      if (!r.ok) { setErreur(t(cleErreurPasUneReponse(r.raison))); return; }
      const cle = r.raison === 'autre_reponse_en_attente' ? 'autreEnAttente' : r.restaure ? 'ok' : 'okSansReprise';
      toast({ title: t(`outreach.reponses.pasUneReponse.${cle}`) });
      onFermee();
    },
    onError: () => setErreur(t(cleErreurPasUneReponse(null))),
  });

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border bg-white px-5 py-3 flex-shrink-0">
        <Button variant="ghost" size="sm" className="lg:hidden -ml-2 mb-1" onClick={onRetour}>
          <ArrowLeft className="h-4 w-4 mr-1" />{t('outreach.reponses.retour')}
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">{lead.name}</h2>
          {lead.company && <span className="text-sm text-muted-foreground">· {lead.company}</span>}
          <CanalIcone className="h-4 w-4 text-muted-foreground" aria-label={conversation.channel === 'linkedin' ? t('outreach.reponses.canalLinkedin') : t('outreach.reponses.canalEmail')} />
          {lead.linkedinUrl && /^https?:\/\//i.test(lead.linkedinUrl) && (
            <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />{t('outreach.reponses.ouvrirLinkedin')}
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {[lead.role, campagne ? t('outreach.reponses.campagne', { nom: campagne.name }) : null].filter(Boolean).join(' · ')}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 bg-muted/20"><Fil messages={messages} /></div>

      <footer className="border-t border-border bg-white px-5 py-3 space-y-2 flex-shrink-0">
        <label htmlFor="reponse-texte" className="text-xs font-medium text-muted-foreground">{t('outreach.reponses.reponseLabel')}</label>
        <Textarea id="reponse-texte" rows={5} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={t('outreach.reponses.placeholder')} />
        {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={demanderProposition} disabled={proposer.isPending}>
            {proposer.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {proposer.isPending ? t('outreach.reponses.proposerEnCours') : t('outreach.reponses.proposer')}
          </Button>
          <Button size="sm" onClick={envoyerTexte} disabled={envoyer.isPending || !texte.trim()}>
            {envoyer.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            {envoyer.isPending ? t('outreach.reponses.envoyerEnCours') : t('outreach.reponses.envoyer')}
          </Button>
          {conversation.statut === 'a_traiter' && (
            <>
              <Button variant="ghost" size="sm" onClick={marquerTraitee} disabled={traitee.isPending}>{t('outreach.reponses.traitee')}</Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={pasUneVraie} disabled={pasUne.isPending}>
                {t('outreach.reponses.pasUneReponseBouton')}
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
