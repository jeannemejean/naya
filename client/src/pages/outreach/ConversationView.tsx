// Fil d'une conversation de la boîte « Réponses » : messages, fiche courte du prospect, zone de
// réponse (préremplie par « Proposer une réponse ») et actions. Rien ne part sans « Envoyer ».
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarClock, ExternalLink, Linkedin, Loader2, Mail, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  useConversation, useProposerReponse, useEnvoyerReponse, useMarquerTraitee, usePasUneReponse,
  useValiderRelance, useRefuserRelance, useReformulerRelance,
  type ConversationDetail,
} from './useReponses';
import {
  cleErreurEnvoi, cleErreurPasUneReponse, cleErreurRelance, dateHeure, dateRelative, idMessageBoite, jourLisible,
  ordonnerFil, prenom, typeBulle,
} from './reponses-logique';
import { aUneCitation, texteAffiche } from '@shared/citation';
import EtiquetteCampagne from './EtiquetteCampagne';

/** Une bulle : le texte nouveau seulement, l'original complet à un clic (rien n'est perdu). */
function Bulle({ m, type, auteur, date }: {
  m: ConversationDetail['messages'][number]; type: 'entrant' | 'sortant' | 'en_attente'; auteur: string; date: string;
}) {
  const { t } = useTranslation();
  const [complet, setComplet] = useState(false);
  const sortant = type !== 'entrant';
  const cite = aUneCitation(m.body);
  const texte = complet ? (m.body ?? '') : texteAffiche(m.body);
  return (
    <div className={`flex min-w-0 ${sortant ? 'justify-end' : 'justify-start'}`}>
      <div className={`min-w-0 max-w-[85%] sm:max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm border ${
        sortant ? 'bg-primary/5 border-primary/20' : 'bg-white border-border'
      } ${type === 'en_attente' ? 'opacity-60' : ''}`}>
        <p className="text-xs text-muted-foreground mb-1">
          <span className="font-semibold text-foreground">{auteur}</span>
          {' · '}{type === 'en_attente' ? t('outreach.reponses.envoiEnCours') : date}
        </p>
        {m.subject && <p className="text-xs font-semibold text-foreground mb-1 break-words [overflow-wrap:anywhere]">{m.subject}</p>}
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground">{texte}</p>
        {cite && (
          <button type="button" onClick={() => setComplet((v) => !v)} aria-expanded={complet}
            className="mt-1.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {complet ? t('outreach.reponses.masquerCitation') : t('outreach.reponses.voirComplet')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Fil façon messagerie : envoyés et reçus dans l'ordre, le plus récent en bas. */
export function Fil({ messages, nomProspect, apres }: {
  messages: ConversationDetail['messages']; nomProspect: string;
  /** Rendu sous un message (proposition de relance sous la réponse du prospect). */
  apres?: (m: ConversationDetail['messages'][number]) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const now = new Date();
  return (
    <div className="space-y-3" data-testid="fil-reponses">
      {ordonnerFil(messages).map((m) => {
        const type = typeBulle(m);
        const relatif = dateRelative(m.sentAt, now, i18n.language);
        if (type === 'discret') {
          return (
            <p key={m.id} className="text-xs text-muted-foreground text-center italic">
              {m.nature === 'absence' ? t('outreach.reponses.absence') : t('outreach.reponses.accuse')} · {relatif}
            </p>
          );
        }
        const absolu = dateHeure(m.sentAt, i18n.language);
        const date = absolu && relatif && absolu !== relatif ? `${absolu} (${relatif})` : absolu || relatif;
        const auteur = type === 'entrant' ? nomProspect : t('outreach.reponses.vous');
        const sous = apres?.(m);
        if (!sous) return <Bulle key={m.id} m={m} type={type} auteur={auteur} date={date} />;
        return (
          <div key={m.id} className="space-y-2">
            <Bulle m={m} type={type} auteur={auteur} date={date} />
            {sous}
          </div>
        );
      })}
    </div>
  );
}

/** AAAA-MM-JJ de demain (heure locale) : la date de relance la plus proche possible. */
function demain(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Sous la réponse d'un prospect qui demande d'être recontacté plus tard : « Relancer Claire le
 * lundi 4 janvier ? ». Seulement une proposition : rien n'existe tant qu'elle n'est pas validée.
 */
function CarteRelance({ conversationId, m, nomProspect }: {
  conversationId: number; m: ConversationDetail['messages'][number]; nomProspect: string;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const valider = useValiderRelance(conversationId);
  const refuser = useRefuserRelance(conversationId);
  const [changer, setChanger] = useState(false);
  const [date, setDate] = useState(m.relance?.date ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const r = m.relance;
  const mid = idMessageBoite(m.id);
  if (!r || mid == null) return null;
  const p = prenom(nomProspect);
  const lisible = (d: string | null | undefined) => jourLisible(d, i18n.language);
  const cadre = 'flex justify-start';
  const carte = 'max-w-[85%] sm:max-w-[75%] rounded-xl border px-3.5 py-2.5 text-sm';

  if (r.statut === 'validee' || r.statut === 'en_cours') {
    const texte = r.statut === 'en_cours'
      ? t('outreach.reponses.relance.enCours')
      : r.faite ? t('outreach.reponses.relance.faite', { date: lisible(r.date) }) : t('outreach.reponses.relance.prevue', { prenom: p, date: lisible(r.date) });
    return (
      <div className={cadre}>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="relance-statut">
          <CalendarClock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />{texte}
        </p>
      </div>
    );
  }

  const lancer = (choisie?: string) => {
    setErreur(null);
    valider.mutate({ messageId: mid, date: choisie }, {
      onSuccess: (res) => {
        if (res.ok) toast({ title: t('outreach.reponses.relance.valideeOk', { date: lisible(res.date) }) });
        else setErreur(t(cleErreurRelance(res.raison)));
      },
      onError: () => setErreur(t(cleErreurRelance('echec'))),
    });
  };
  const nonMerci = () => {
    setErreur(null);
    refuser.mutate(mid, {
      onSuccess: (res) => { if (!res.ok) setErreur(t(cleErreurRelance(res.raison))); },
      onError: () => setErreur(t(cleErreurRelance('echec'))),
    });
  };
  const occupe = valider.isPending || refuser.isPending;

  return (
    <div className={cadre}>
      <div className={`${carte} bg-sulphur-subtle border-naya-sulphur/50 text-foreground space-y-2`} data-testid="relance-proposition">
        <p className="flex items-center gap-1.5 font-medium">
          <CalendarClock className="h-4 w-4 flex-shrink-0" aria-hidden />
          {t('outreach.reponses.relance.proposition', { prenom: p, date: lisible(r.date) })}
        </p>
        <p className="text-xs text-muted-foreground">{t('outreach.reponses.relance.explication')}</p>
        {changer ? (
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor={`relance-date-${mid}`} className="sr-only">{t('outreach.reponses.relance.choisirDate')}</label>
            <input id={`relance-date-${mid}`} type="date" min={demain()} value={date} onChange={(e) => setDate(e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-sm text-foreground" />
            <Button size="sm" onClick={() => lancer(date)} disabled={occupe || !date}>
              {valider.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {valider.isPending ? t('outreach.reponses.relance.redaction') : t('outreach.reponses.relance.confirmerDate')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setChanger(false); setErreur(null); }} disabled={occupe}>
              {t('outreach.reponses.relance.annuler')}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => lancer()} disabled={occupe}>
              {valider.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {valider.isPending ? t('outreach.reponses.relance.redaction') : t('outreach.reponses.relance.valider')}
            </Button>
            <Button size="sm" variant="outline" className="bg-white" onClick={() => setChanger(true)} disabled={occupe}>
              {t('outreach.reponses.relance.changer')}
            </Button>
            <Button size="sm" variant="ghost" onClick={nonMerci} disabled={occupe}>{t('outreach.reponses.relance.nonMerci')}</Button>
          </div>
        )}
        {erreur && <p role="alert" className="text-xs text-destructive">{erreur}</p>}
      </div>
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
  const reformuler = useReformulerRelance(id);
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const zoneFil = useRef<HTMLDivElement>(null);
  const nbMessages = data?.messages.length ?? 0;
  // Le plus récent en bas, visible à l'ouverture et à chaque nouveau message. On fait défiler
  // la zone du fil elle-même (scrollIntoView ferait aussi défiler les parents overflow-hidden).
  useEffect(() => {
    const el = zoneFil.current;
    if (el && nbMessages) el.scrollTop = el.scrollHeight;
  }, [nbMessages]);
  // Le jour de la relance : le message rédigé à la validation attend dans « Ta réponse »
  // (sans jamais écraser ce que l'utilisatrice a déjà commencé à écrire).
  const prete = data?.relancePrete ?? null;
  const prerempli = useRef<number | null>(null);
  useEffect(() => {
    if (!prete || prerempli.current === prete.taskId) return;
    prerempli.current = prete.taskId;
    setTexte((avant) => (avant.trim() ? avant : prete.texte));
  }, [prete]);

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
  const autreVersion = () => {
    if (!prete) return;
    setErreur(null);
    reformuler.mutate(prete.messageId, {
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
      const cle = r.raison === 'autre_reponse_en_attente' ? 'autreEnAttente'
        : r.raison === 'relance_prevue' ? 'relancePrevue' : r.restaure ? 'ok' : 'okSansReprise';
      toast({ title: t(`outreach.reponses.pasUneReponse.${cle}`) });
      onFermee();
    },
    onError: () => setErreur(t(cleErreurPasUneReponse(null))),
  });

  return (
    <div className="flex flex-col h-full min-h-0">
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
        {(lead.role || campagne) && (
          <div className="flex items-center gap-2 flex-wrap mt-1 min-w-0">
            {campagne && <EtiquetteCampagne id={campagne.id} nom={campagne.name} />}
            {lead.role && <span className="text-xs text-muted-foreground">{lead.role}</span>}
          </div>
        )}
      </header>

      <div ref={zoneFil} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 sm:px-5 py-4 bg-muted/20">
        <Fil messages={messages} nomProspect={lead.name}
          apres={(m) => (m.relance ? <CarteRelance conversationId={conversation.id} m={m} nomProspect={lead.name} /> : null)} />
      </div>

      <footer className="border-t border-border bg-white px-4 sm:px-5 py-3 space-y-2 flex-shrink-0">
        <label htmlFor="reponse-texte" className="text-xs font-medium text-muted-foreground">{t('outreach.reponses.reponseLabel')}</label>
        {prete && (
          <p className="flex items-center gap-1.5 text-xs text-foreground" data-testid="relance-prete">
            <CalendarClock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {t('outreach.reponses.relance.prete', { prenom: prenom(lead.name) })}
          </p>
        )}
        <Textarea id="reponse-texte" rows={3} className="max-h-[30vh]" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={t('outreach.reponses.placeholder')} />
        {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          {prete ? (
            <Button variant="outline" size="sm" onClick={autreVersion} disabled={reformuler.isPending}>
              {reformuler.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {reformuler.isPending ? t('outreach.reponses.proposerEnCours') : t('outreach.reponses.relance.autreVersion')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={demanderProposition} disabled={proposer.isPending}>
              {proposer.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {proposer.isPending ? t('outreach.reponses.proposerEnCours') : t('outreach.reponses.proposer')}
            </Button>
          )}
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
