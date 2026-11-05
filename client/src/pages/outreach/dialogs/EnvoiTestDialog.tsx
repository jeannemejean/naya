// « Envoyer un test » : nom (facultatif) + adresse, l'email test part tout de suite.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useEnvoyerTest } from '../useOutreach';
import { codeRefusTest, emailTestValide } from '../mode-test';

interface EnvoiTestDialogProps {
  campaignId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EnvoiTestDialog({ campaignId, open, onOpenChange }: EnvoiTestDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const envoyer = useEnvoyerTest(campaignId);
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [touche, setTouche] = useState(false);

  const emailOk = emailTestValide(email);

  const fermer = (o: boolean) => {
    if (envoyer.isPending) return;
    if (!o) { setNom(''); setEmail(''); setTouche(false); }
    onOpenChange(o);
  };

  const soumettre = (e: React.FormEvent) => {
    e.preventDefault();
    setTouche(true);
    if (!emailOk) return;
    const adresse = email.trim();
    envoyer.mutate({ nom: nom.trim(), email: adresse }, {
      onSuccess: (r) => {
        toast({
          title: t('outreach.modeTest.succesTitre'),
          description: r.secours
            ? t('outreach.modeTest.succesSecours', { email: adresse })
            : t('outreach.modeTest.succes', { email: adresse }),
        });
        setNom(''); setEmail(''); setTouche(false);
        onOpenChange(false);
      },
      onError: (err) => toast({
        title: t('outreach.modeTest.erreurTitre'),
        description: t(`outreach.modeTest.erreurs.${codeRefusTest(err)}`),
        variant: 'destructive',
      }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={fermer}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('outreach.modeTest.titre')}</DialogTitle>
          <DialogDescription>{t('outreach.modeTest.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <Label htmlFor="test-nom" className="text-xs">{t('outreach.modeTest.nom')}</Label>
            <Input
              id="test-nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder={t('outreach.modeTest.badge')}
              className="h-8 text-sm"
              maxLength={120}
            />
            <p className="text-[11px] text-muted-foreground mt-1">{t('outreach.modeTest.nomAide')}</p>
          </div>
          <div>
            <Label htmlFor="test-email" className="text-xs">{t('outreach.modeTest.email')}</Label>
            <Input
              id="test-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouche(true)}
              className="h-8 text-sm"
              required
              aria-invalid={touche && !emailOk}
            />
            {touche && !emailOk ? (
              <p className="text-[11px] text-destructive mt-1">{t('outreach.modeTest.emailInvalide')}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-1">{t('outreach.modeTest.emailAide')}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => fermer(false)} disabled={envoyer.isPending}>
              {t('outreach.modeTest.annuler')}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5 bg-primary text-primary-foreground hover:opacity-90"
              disabled={envoyer.isPending || (touche && !emailOk)}
            >
              {envoyer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {envoyer.isPending ? t('outreach.modeTest.envoi') : t('outreach.modeTest.envoyer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
