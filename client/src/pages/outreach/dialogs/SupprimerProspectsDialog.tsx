// Confirmation de la suppression DÉFINITIVE d'un ou plusieurs prospects (irréversible).
// Utilisée par la fiche prospect, le Pipeline et la liste des prospects d'une campagne.
// L'archivage reste un geste distinct, réversible.
import { useTranslation } from 'react-i18next';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useDeleteLeads, type ResultatSuppression } from '../useOutreach';
import { messagesSuppression } from './suppression-messages';

interface Props {
  ids: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Appelé après la suppression, avec les ids réellement supprimés. */
  onDone?: (supprimes: number[]) => void;
}

export default function SupprimerProspectsDialog({ ids, open, onOpenChange, onDone }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const suppression = useDeleteLeads();
  const n = ids.length;

  const confirmer = (e: React.MouseEvent) => {
    e.preventDefault(); // le dialogue reste ouvert pendant la requête
    suppression.mutate(ids, {
      onSuccess: (res: ResultatSuppression) => {
        onOpenChange(false);
        onDone?.(res.ids);
        for (const m of messagesSuppression(res)) {
          toast({ title: t(m.cle, { count: m.count }), variant: m.erreur ? 'destructive' : undefined });
        }
      },
      onError: () => toast({ title: t('outreach.suppression.erreur'), variant: 'destructive' }),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !suppression.isPending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {n > 1 ? t('outreach.suppression.titrePlusieurs', { count: n }) : t('outreach.suppression.titreUn')}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              {n > 1 ? t('outreach.suppression.descriptionPlusieurs', { count: n }) : t('outreach.suppression.descriptionUn')}
            </span>
            <span className="block text-xs">{t('outreach.suppression.detail')}</span>
            <span className="block text-xs">{t('outreach.suppression.detailDesinscrit')}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={suppression.isPending}>{t('outreach.suppression.annuler')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmer}
            disabled={suppression.isPending || n === 0}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {suppression.isPending ? t('outreach.suppression.enCours') : t('outreach.suppression.confirmer')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
