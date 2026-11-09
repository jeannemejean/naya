// Panneau « Salves » de l'onglet Prospects. Une salve prend des prospects validés et les
// étale sur plusieurs jours ; elle s'ouvre uniquement par un clic confirmé (ce panneau, ou
// « Lancer en salve » qui ouvre le même formulaire). La règle vit
// côté serveur (server/services/prospection-salves.ts), les chiffres viennent des séquences.
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Rocket, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useArreterSalve, useLancerSalve, useSalves } from './useOutreach';
import {
  dateCourte, joursNecessaires, nombreBorne, nombrePrerempli, raisonSalveImpossible,
  SALVE_NOMBRE_DEFAUT, SALVE_NOMBRE_MAX, SALVE_PAR_JOUR_DEFAUT, SALVE_PAR_JOUR_MAX,
} from './salves';
import type { SalveDTO } from './types';

export default function SalvesPanel({ campaignId, prets, hasSequence }: { campaignId: number; prets: number; hasSequence: boolean }) {
  const { t } = useTranslation();
  const { data: salves = [] } = useSalves(campaignId);

  if (prets === 0 && salves.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t('outreach.salves.titre')}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t('outreach.salves.intro', { count: prets })}</p>
      </div>

      {prets > 0 && (
        <FormulaireSalve campaignId={campaignId} prets={prets} hasSequence={hasSequence} nombreInitial={SALVE_NOMBRE_DEFAUT} />
      )}

      {salves.length > 0 && (
        <ul className="space-y-2">
          {salves.map((salve) => <LigneSalve key={salve.id} salve={salve} campaignId={campaignId} />)}
        </ul>
      )}
    </section>
  );
}

/**
 * Le formulaire d'une salve (nombre, rythme, confirmation). Le seul : le panneau l'affiche, et
 * « Lancer en salve » l'ouvre dans une fenêtre, prérempli avec tous les prospects prêts.
 */
function FormulaireSalve({ campaignId, prets, hasSequence, nombreInitial, leadIds, onLancee }: {
  campaignId: number; prets: number; hasSequence: boolean; nombreInitial: number;
  /** Sélection explicite : la salve ne prend que ces prospects. */
  leadIds?: number[];
  onLancee?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const lancer = useLancerSalve(campaignId);
  const idChamp = useId();
  const [nombreSaisi, setNombreSaisi] = useState(String(nombreInitial));
  const [parJourSaisi, setParJourSaisi] = useState(String(SALVE_PAR_JOUR_DEFAUT));

  const nombreMax = Math.min(prets, SALVE_NOMBRE_MAX);
  const nombre = nombreBorne(nombreSaisi, nombreMax);
  const parJour = nombreBorne(parJourSaisi, SALVE_PAR_JOUR_MAX);
  const jours = joursNecessaires(nombre, parJour);

  const lancerLaSalve = () => lancer.mutate(leadIds ? { nombre, parJour, leadIds } : { nombre, parJour }, {
    onSuccess: (r) => {
      toast({
        title: t('outreach.salves.lancee', { count: r.programmes }),
        description: r.premierEnvoi && r.dernierEnvoi
          ? t('outreach.salves.lanceeDetail', { debut: dateCourte(r.premierEnvoi, i18n.language), fin: dateCourte(r.dernierEnvoi, i18n.language) })
          : t('outreach.salves.lanceeVide'),
      });
      onLancee?.();
    },
    onError: () => toast({ title: t('outreach.salves.erreur'), variant: 'destructive' }),
  });

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <Label htmlFor={`${idChamp}-nombre`} className="text-xs">{t('outreach.salves.nombre')}</Label>
        <Input id={`${idChamp}-nombre`} type="number" min={1} max={nombreMax} className="h-8 w-24 text-sm" value={nombreSaisi === '' ? '' : nombre} onChange={(e) => setNombreSaisi(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idChamp}-par-jour`} className="text-xs">{t('outreach.salves.parJour')}</Label>
        <Input id={`${idChamp}-par-jour`} type="number" min={1} max={SALVE_PAR_JOUR_MAX} className="h-8 w-24 text-sm" value={parJourSaisi} onChange={(e) => setParJourSaisi(e.target.value)} />
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" className="h-8 gap-1.5" disabled={!hasSequence || nombre === 0 || parJour === 0 || lancer.isPending}>
            {lancer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {t('outreach.salves.lancer')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('outreach.salves.confirmTitre', { count: nombre })}</AlertDialogTitle>
            <AlertDialogDescription>{t('outreach.salves.confirmTexte', { count: jours, parJour })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('outreach.salves.annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={lancerLaSalve}>{t('outreach.salves.confirmer')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-xs text-muted-foreground">{t('outreach.salves.duree', { count: jours })}</p>
    </div>
  );
}

/**
 * La fenêtre qui porte le formulaire de salve, prérempli avec tous les prêts (plafonné à
 * SALVE_NOMBRE_MAX). Rien ne part avant la confirmation du formulaire.
 */
export function FenetreSalve({ ouvert, onOuvertChange, campaignId, prets, hasSequence, leadIds, onLancee }: {
  ouvert: boolean; onOuvertChange: (ouvert: boolean) => void;
  campaignId: number; prets: number; hasSequence: boolean;
  /** « Ajouter la sélection » au-delà de 5 : la salve ne prend que ces prospects. */
  leadIds?: number[];
  onLancee?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(leadIds ? 'outreach.salves.selectionTitre' : 'outreach.salves.lancerEnSalve')}</DialogTitle>
          <DialogDescription>{t(leadIds ? 'outreach.salves.selectionIntro' : 'outreach.salves.intro', { count: prets })}</DialogDescription>
        </DialogHeader>
        {ouvert && (
          <FormulaireSalve
            campaignId={campaignId} prets={prets} hasSequence={hasSequence} leadIds={leadIds}
            nombreInitial={nombrePrerempli(prets)}
            onLancee={() => { onOuvertChange(false); onLancee?.(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** « Lancer en salve » (ex-« Lancer pour tous ») : ouvre la fenêtre de salve. */
export function BoutonLancerEnSalve({ campaignId, prets, hasSequence, className }: {
  campaignId: number; prets: number; hasSequence: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const raison = raisonSalveImpossible({ hasSequence, prets });
  const explication = raison ? t(`outreach.salves.${raison}`) : undefined;

  return (
    <>
      {/* Un bouton grisé ne reçoit pas le survol : l'explication est portée par son enveloppe. */}
      <span title={explication} className="inline-flex" tabIndex={raison ? 0 : undefined}>
        <Button size="sm" variant="outline" className={className ?? 'gap-1.5'} disabled={raison !== null} onClick={() => setOuvert(true)}>
          <Rocket className="w-3.5 h-3.5" />
          {t('outreach.salves.lancerEnSalve')}
        </Button>
      </span>
      <FenetreSalve ouvert={ouvert} onOuvertChange={setOuvert} campaignId={campaignId} prets={prets} hasSequence={hasSequence} />
    </>
  );
}

function LigneSalve({ salve, campaignId }: { salve: SalveDTO; campaignId: number }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const arreter = useArreterSalve(campaignId);
  const stopper = () => arreter.mutate(salve.id, {
    onSuccess: (r) => toast({ title: t('outreach.salves.arretee', { count: r.arretes }) }),
    onError: () => toast({ title: t('outreach.salves.erreur'), variant: 'destructive' }),
  });

  return (
    <li className="flex items-center gap-3 flex-wrap rounded-lg bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">
          {t('outreach.salves.ligne', { date: salve.createdAt ? dateCourte(salve.createdAt, i18n.language) : '', count: salve.prevus })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('outreach.salves.bilan', { partis: salve.partis, reponses: salve.reponses, attente: salve.enAttente, bloques: salve.bloques })}
          {salve.prochainEnvoi ? ` ${t('outreach.salves.prochain', { date: dateCourte(salve.prochainEnvoi, i18n.language) })}` : ''}
        </p>
      </div>
      {salve.enAttente > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={arreter.isPending}>{t('outreach.salves.arreter')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('outreach.salves.arreterTitre')}</AlertDialogTitle>
              <AlertDialogDescription>{t('outreach.salves.arreterTexte')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('outreach.salves.annuler')}</AlertDialogCancel>
              <AlertDialogAction onClick={stopper}>{t('outreach.salves.arreter')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}
