// Séance de redémarrage, en tête du chat : la proposer après une absence, suivre « projet 3/7 »,
// la reprendre plus tard, et la lancer à tout moment (« Faire le point »).
import { useTranslation } from "react-i18next";
import type { PropositionVue } from "@shared/agent";
import { Propositions, type SuiviProposition } from "./Propositions";
import { styleBoutonAgent, styleLigneAgent } from "./ActionsFaites";

export interface EtatSeance {
  seance: null | {
    id: number;
    statut: string;
    position: number;
    total: number;
    projetCourant: { projectId: number; nom: string } | null;
    propositionEnAttente?: PropositionVue;
  };
  proposer: boolean;
}

export function SeanceBandeau({
  etat, envoiEnCours, propositionsAffichees, suivi, onCommencer, onPlusTard, onAbandonner, onValider, onAnnuler,
}: {
  etat: EtatSeance | null;
  envoiEnCours: boolean;
  /** Ids des propositions déjà visibles dans le fil (pour ne pas les montrer deux fois). */
  propositionsAffichees: Set<number>;
  suivi: Record<number, SuiviProposition | undefined>;
  onCommencer: () => void;
  onPlusTard: () => void;
  onAbandonner: () => void;
  onValider: (id: number, lignes?: number[]) => void;
  onAnnuler: (id: number) => void;
}) {
  const { t } = useTranslation();
  if (!etat) return null; // séance non activée pour ce compte
  const boite = { borderBottom: '1px solid var(--border)', padding: '8px 12px', display: 'flex', flexDirection: 'column' as const, gap: 6 };

  if (etat.seance) {
    const s = etat.seance;
    const enAttente = s.propositionEnAttente && !propositionsAffichees.has(s.propositionEnAttente.id) ? [s.propositionEnAttente] : [];
    return (
      <div style={boite}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <span style={{ ...styleLigneAgent, color: 'var(--foreground)' }}>
            {s.projetCourant
              ? t('redemarrage.progression', { position: s.position, total: s.total, projet: s.projetCourant.nom })
              : t('redemarrage.enCours')}
          </span>
          <span style={{ display: 'flex', gap: 10 }}>
            <button type="button" style={styleBoutonAgent} onClick={onPlusTard}>{t('redemarrage.plusTard')}</button>
            <button type="button" style={{ ...styleBoutonAgent, color: 'var(--muted-foreground)' }} onClick={onAbandonner}>{t('redemarrage.abandonner')}</button>
          </span>
        </div>
        {enAttente.length > 0 && (
          <Propositions propositions={enAttente} suivi={suivi} onValider={onValider} onAnnuler={onAnnuler} />
        )}
      </div>
    );
  }

  if (etat.proposer) {
    return (
      <div style={boite}>
        <span style={{ ...styleLigneAgent, color: 'var(--foreground)' }}>{t('redemarrage.proposition')}</span>
        <span style={{ display: 'flex', gap: 12 }}>
          <button type="button" disabled={envoiEnCours} style={{ ...styleBoutonAgent, fontWeight: 500 }} onClick={onCommencer}>{t('redemarrage.commencer')}</button>
          <button type="button" style={{ ...styleBoutonAgent, color: 'var(--muted-foreground)' }} onClick={onPlusTard}>{t('redemarrage.plusTardCourt')}</button>
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...boite, flexDirection: 'row', justifyContent: 'flex-end' }}>
      <button type="button" disabled={envoiEnCours} style={{ ...styleBoutonAgent, color: 'var(--muted-foreground)' }} onClick={onCommencer}>
        {t('redemarrage.fairePoint')}
      </button>
    </div>
  );
}
