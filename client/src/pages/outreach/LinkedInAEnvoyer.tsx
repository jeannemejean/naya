// Panneau « À envoyer sur LinkedIn » de l'onglet Prospects. Sans envoi automatique, Naya
// rédige les messages LinkedIn et la séquence du prospect ATTEND (comme une tâche manuelle
// chez lemlist). « Envoyé » reprend la séquence à partir de ce moment ; « Passer » saute
// l'étape. La règle vit côté serveur (prospection-linkedin-manuel.ts).
import { useTranslation } from 'react-i18next';
import { Check, Copy, UserCheck, ExternalLink, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useLinkedInTasks, useLinkedInTaskAction, useInvitationAcceptee, useLeads, type LinkedInTask } from './useOutreach';

export default function LinkedInAEnvoyer({ campaignId }: { campaignId: number }) {
  const { t } = useTranslation();
  const { data: taches = [] } = useLinkedInTasks(campaignId);
  if (taches.length === 0) return null;

  return (
    <section className="rounded-xl border border-naya-salvia/40 bg-naya-salvia/5 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t('outreach.linkedinManuel.titre', { count: taches.length })}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t('outreach.linkedinManuel.intro')}</p>
      </div>
      <div className="space-y-3">
        {taches.map((tache) => <CarteLinkedIn key={tache.id} tache={tache} campaignId={campaignId} />)}
      </div>
    </section>
  );
}

function CarteLinkedIn({ tache, campaignId }: { tache: LinkedInTask; campaignId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const action = useLinkedInTaskAction(campaignId);
  const acceptee = useInvitationAcceptee();
  const { data: leads = [] } = useLeads();
  const dejaAcceptee = !!(leads.find((l) => l.id === tache.leadId) as any)?.linkedinConnectedAt;
  const accepter = () => acceptee.mutate(tache.leadId, {
    onSuccess: () => toast({ title: t('outreach.linkedinManuel.invitationAccepteeOk') }),
    onError: () => toast({ title: t('outreach.linkedinManuel.erreur'), variant: 'destructive' }),
  });

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(tache.body);
      toast({ title: t('outreach.linkedinManuel.copie') });
    } catch {
      toast({ title: t('outreach.linkedinManuel.erreur'), variant: 'destructive' });
    }
  };
  const agir = (quoi: 'sent' | 'skip') => action.mutate(
    { id: tache.id, quoi },
    {
      onSuccess: () => toast({ title: t(quoi === 'sent' ? 'outreach.linkedinManuel.envoyeOk' : 'outreach.linkedinManuel.passeOk') }),
      onError: () => toast({ title: t('outreach.linkedinManuel.erreur'), variant: 'destructive' }),
    },
  );

  return (
    <div className="rounded-lg border border-border bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {tache.leadName}{tache.company ? ` · ${tache.company}` : ''}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {tache.stepOrder != null && (
              <span className="text-xs text-muted-foreground">{t('outreach.linkedinManuel.etape', { n: tache.stepOrder })}</span>
            )}
            {tache.bloquant && <Badge variant="salvia">{t('outreach.linkedinManuel.attend')}</Badge>}
          </div>
        </div>
        {tache.linkedinUrl && (
          <a
            href={tache.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('outreach.linkedinManuel.profil')}
          </a>
        )}
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap rounded-md bg-muted/40 p-2">{tache.body}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copier}>
          <Copy className="w-3.5 h-3.5" />
          {t('outreach.linkedinManuel.copier')}
        </Button>
        <Button size="sm" className="gap-1.5" disabled={action.isPending} onClick={() => agir('sent')}>
          <Check className="w-3.5 h-3.5" />
          {t('outreach.linkedinManuel.envoye')}
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" disabled={action.isPending} onClick={() => agir('skip')}>
          <SkipForward className="w-3.5 h-3.5" />
          {t('outreach.linkedinManuel.passer')}
        </Button>
        {!dejaAcceptee && (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={acceptee.isPending} onClick={accepter}>
            <UserCheck className="w-3.5 h-3.5" />
            {t('outreach.linkedinManuel.invitationAcceptee')}
          </Button>
        )}
      </div>
    </div>
  );
}
