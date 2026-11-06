// Ce que l'utilisatrice lit après une suppression (pur, testé).
import type { ResultatSuppression } from '../useOutreach';

export interface MessageSuppression { cle: string; count: number; erreur?: boolean }

export function messagesSuppression(res: Pick<ResultatSuppression, 'supprimes' | 'refuses'>): MessageSuppression[] {
  const out: MessageSuppression[] = [];
  if (res.supprimes === 1) out.push({ cle: 'outreach.suppression.succesUn', count: 1 });
  else if (res.supprimes > 1) out.push({ cle: 'outreach.suppression.succesPlusieurs', count: res.supprimes });
  const compte = (r: string) => res.refuses.filter((x) => x.raison === r).length;
  if (compte('envoi_en_cours')) out.push({ cle: 'outreach.suppression.envoiEnCours', count: compte('envoi_en_cours'), erreur: true });
  if (compte('introuvable')) out.push({ cle: 'outreach.suppression.introuvables', count: compte('introuvable'), erreur: true });
  if (compte('erreur')) out.push({ cle: 'outreach.suppression.erreur', count: compte('erreur'), erreur: true });
  return out;
}
