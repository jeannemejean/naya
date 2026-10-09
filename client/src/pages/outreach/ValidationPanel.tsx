// Panneau « Messages à valider » de l'onglet Prospects — là où mène la tâche du planning
// « Valider les messages préparés par Naya ». Naya a rédigé ; l'utilisatrice relit, corrige
// si besoin, puis valide (ou écarte). Rien ne part sans cet accord : la barrière est côté
// serveur (prospection-validation.ts), ce panneau n'est que la porte pour la franchir.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCheck, Loader2, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import type { Lead } from '@shared/schema';
import { useUpdateLead, useValidateLeads } from './useOutreach';
import { channelMeta } from './channels';
import {
  LIMITE_NOTE_LINKEDIN, depasseLimite, messagesAValider, miseAJourMessage, type MessageAValider,
} from './validation-messages';

interface ValidationPanelProps {
  prospects: Lead[];
  onOpenLead: (lead: Lead) => void;
}

export default function ValidationPanel({ prospects, onOpenLead }: ValidationPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const validate = useValidateLeads();
  const [enCours, setEnCours] = useState<Set<number>>(new Set());

  if (prospects.length === 0) return null;

  // Une note LinkedIn trop longue serait refusée par LinkedIn : on ne la valide pas en lot.
  const validables = prospects.filter((l) => !messagesAValider(l as any).some(depasseLimite));

  const valider = (ids: number[]) => {
    setEnCours((prev) => new Set([...Array.from(prev), ...ids]));
    validate.mutate(ids, {
      onSuccess: (n) => toast({ title: t('outreach.validation.valides'), description: t('outreach.validation.resume', { count: n }) }),
      onError: () => toast({ title: t('outreach.validation.erreur'), description: t('outreach.validation.erreurValidation'), variant: 'destructive' }),
      onSettled: () => setEnCours((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }),
    });
  };

  return (
    <section className="rounded-xl border border-naya-mauve/40 bg-naya-mauve/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t('outreach.validation.titre', { count: prospects.length })}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('outreach.validation.intro')}</p>
        </div>
        {validables.length > 1 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={validate.isPending}>
                <CheckCheck className="w-3.5 h-3.5" />
                {t('outreach.validation.toutValider', { count: validables.length })}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('outreach.validation.confirmTitre', { count: validables.length })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('outreach.validation.confirmTexte')}
                  {validables.length < prospects.length && ` ${t('outreach.validation.confirmTropLongs')}`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('outreach.validation.annuler')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => valider(validables.map((l) => l.id))}>
                  {t('outreach.validation.valider')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="space-y-3">
        {prospects.map((lead) => (
          <CarteAValider
            key={lead.id}
            lead={lead}
            enCours={enCours.has(lead.id)}
            onValider={() => valider([lead.id])}
            onOpen={() => onOpenLead(lead)}
          />
        ))}
      </div>
    </section>
  );
}

function CarteAValider({
  lead, enCours, onValider, onOpen,
}: { lead: Lead; enCours: boolean; onValider: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const updateLead = useUpdateLead();
  const l = lead as any;
  const messages = messagesAValider(l);
  const [brouillons, setBrouillons] = useState<Record<string, string>>({});
  useEffect(() => setBrouillons({}), [lead.id]);

  const texte = (m: MessageAValider) => brouillons[m.champ] ?? m.texte;
  const libelle = (m: MessageAValider) =>
    m.canal === 'linkedin' ? t('outreach.validation.noteLinkedin') : t('outreach.validation.email');
  const tropLong = messages.some((m) => depasseLimite({ canal: m.canal, texte: texte(m) }));

  const enregistrer = (m: MessageAValider) => {
    const brouillon = brouillons[m.champ];
    if (brouillon == null || brouillon === m.texte) return;
    updateLead.mutate(
      { id: lead.id, updates: miseAJourMessage(m.champ, brouillon) as any },
      { onError: () => toast({ title: t('outreach.validation.erreur'), description: t('outreach.validation.erreurCorrection'), variant: 'destructive' }) },
    );
  };

  const ecarter = () => {
    updateLead.mutate(
      { id: lead.id, updates: { stage: 'no_follow' } as any },
      {
        onSuccess: () => toast({ title: t('outreach.validation.ecarte'), description: t('outreach.validation.ecarteTexte', { name: lead.name }) }),
        onError: () => toast({ title: t('outreach.validation.erreur'), description: t('outreach.validation.erreurEcarter'), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-white p-3 space-y-2">
      <button type="button" onClick={onOpen} className="block text-left min-w-0 max-w-full">
        <p className="text-sm font-semibold text-foreground truncate hover:underline">{lead.name}</p>
        {(lead.company || l.role) && (
          <p className="text-xs text-muted-foreground truncate">{[lead.company, l.role].filter(Boolean).join(' · ')}</p>
        )}
      </button>

      {l.qualificationRaison && (
        <p className="text-xs text-muted-foreground italic">
          {t('outreach.validation.pourquoi', { raison: l.qualificationRaison })}
        </p>
      )}

      {messages.map((m) => {
        const meta = channelMeta(m.canal);
        const Icon = meta.Icon;
        const valeur = texte(m);
        const long = depasseLimite({ canal: m.canal, texte: valeur });
        return (
          <div key={m.champ} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
                <Icon className="w-3 h-3" />
                {libelle(m)}
              </span>
              {m.canal === 'linkedin' && (
                <span className={`text-[11px] ${long ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                  {valeur.length}/{LIMITE_NOTE_LINKEDIN}
                </span>
              )}
            </div>
            <Textarea
              value={valeur}
              onChange={(e) => setBrouillons((prev) => ({ ...prev, [m.champ]: e.target.value }))}
              onBlur={() => enregistrer(m)}
              rows={m.canal === 'email' ? 6 : 3}
              className="text-sm"
              aria-label={t('outreach.validation.ariaMessage', { label: libelle(m), name: lead.name })}
            />
          </div>
        );
      })}

      <div className="flex items-center gap-2 justify-end flex-wrap">
        {tropLong && (
          <span className="text-xs text-destructive mr-auto">
            {t('outreach.validation.tropLong', { max: LIMITE_NOTE_LINKEDIN })}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-muted-foreground"
          onClick={ecarter}
          disabled={updateLead.isPending || enCours}
        >
          <UserX className="w-3.5 h-3.5" />
          {t('outreach.validation.ecarter')}
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-primary text-primary-foreground hover:opacity-90"
          onClick={onValider}
          disabled={enCours || tropLong || messages.length === 0}
        >
          {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {t('outreach.validation.valider')}
        </Button>
      </div>
    </div>
  );
}
