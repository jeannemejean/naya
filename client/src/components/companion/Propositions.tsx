// Ce que l'agent propose sans le faire : la liste avant → après, puis « Valider » ou
// « Annuler ». Le suivi vit dans le hook du panneau : un nouveau message met de côté
// les propositions encore en attente (« Ajuster »).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PropositionVue } from "@shared/agent";
import { etatProposition, type StatutPropositionUi } from "./companion-logique";
import { styleBoutonAgent, styleLigneAgent } from "./ActionsFaites";

export interface SuiviProposition {
  statut: StatutPropositionUi;
  reussis?: string[];
  echecs?: string[];
  /** Clé i18n du message d'erreur (statut « erreur »). */
  cle?: string;
}

export function Propositions({
  propositions,
  suivi,
  onValider,
  onAnnuler,
  onSelection,
}: {
  propositions: PropositionVue[];
  suivi: Record<number, SuiviProposition | undefined>;
  onValider: (id: number, lignes?: number[]) => void;
  onAnnuler: (id: number) => void;
  /** Lignes retenues d'une proposition sélectionnable (undefined = toutes), pour un « oui » écrit. */
  onSelection?: (id: number, lignes: number[] | undefined) => void;
}) {
  const { t } = useTranslation();
  // Propositions sélectionnables : les lignes DÉCOCHÉES, par proposition (tout est coché au départ).
  const [decochees, setDecochees] = useState<Record<number, number[]>>({});
  if (propositions.length === 0) return null;
  const basculer = (p: PropositionVue, i: number) => setDecochees((d) => {
    const l = d[p.id] ?? [];
    const nouvelle = l.includes(i) ? l.filter((x) => x !== i) : [...l, i];
    const retenuesApres = p.changements.map((_, k) => k).filter((k) => !nouvelle.includes(k));
    onSelection?.(p.id, nouvelle.length ? retenuesApres : undefined);
    return { ...d, [p.id]: nouvelle };
  });
  const retenues = (p: PropositionVue) => p.changements.map((_, i) => i).filter((i) => !(decochees[p.id] ?? []).includes(i));
  const maintenant = new Date();
  const val = (v: string | null) => (v === null || v === "" ? t('companion.vide') : v);

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {propositions.map((p) => {
        const s = suivi[p.id];
        const expiree = etatProposition(p, maintenant) === "expiree";
        const enAttente = !s || s.statut === "envoi";
        return (
          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ ...styleLigneAgent, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>{t('companion.aValider')}</div>
            <div style={{ ...styleLigneAgent, fontSize: '0.6875rem', color: 'var(--foreground)' }}>{p.resume}</div>
            {p.changements.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {p.changements.map((c, i) => (
                  <li key={i} style={{ ...styleLigneAgent, color: 'var(--foreground)' }}>
                    {p.selectionnable && enAttente && !expiree ? (
                      <input
                        type="checkbox"
                        aria-label={c.libelle}
                        checked={!(decochees[p.id] ?? []).includes(i)}
                        onChange={() => basculer(p, i)}
                        style={{ marginRight: 6, verticalAlign: 'middle' }}
                      />
                    ) : <span style={{ color: 'var(--accent)', opacity: 0.6 }}>◆ </span>}
                    {c.libelle} : <span style={{ color: 'var(--muted-foreground)' }}>{val(c.avant)}</span> → {val(c.apres)}
                  </li>
                ))}
              </ul>
            )}

            {enAttente && !expiree && (
              <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                <button
                  type="button"
                  style={{ ...styleBoutonAgent, fontWeight: 500, opacity: s?.statut === "envoi" ? 0.5 : 1 }}
                  disabled={s?.statut === "envoi" || (p.selectionnable && retenues(p).length === 0)}
                  onClick={() => onValider(p.id, p.selectionnable && retenues(p).length < p.changements.length ? retenues(p) : undefined)}
                >
                  {p.selectionnable && retenues(p).length < p.changements.length
                    ? t('companion.validerSelection', { n: retenues(p).length })
                    : t('companion.valider')}
                </button>
                <button
                  type="button"
                  style={{ ...styleBoutonAgent, color: 'var(--muted-foreground)', opacity: s?.statut === "envoi" ? 0.5 : 1 }}
                  disabled={s?.statut === "envoi"}
                  onClick={() => onAnnuler(p.id)}
                >
                  {t('companion.annuler')}
                </button>
              </div>
            )}
            {enAttente && expiree && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                  <button type="button" style={{ ...styleBoutonAgent, opacity: 0.4, cursor: 'default' }} disabled>{t('companion.valider')}</button>
                  <button type="button" style={{ ...styleBoutonAgent, opacity: 0.4, cursor: 'default' }} disabled>{t('companion.annuler')}</button>
                </div>
                <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--muted-foreground)' }}>{t('companion.proposition.expiree')}</p>
              </div>
            )}
            {s?.statut === "validee" && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(s.reussis ?? []).length > 0 && (
                  <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--accent)' }}>
                    {t('companion.proposition.reussis')} {(s.reussis ?? []).join(' · ')}
                  </p>
                )}
                {(s.echecs ?? []).length > 0 && (
                  <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--destructive)' }}>
                    {t('companion.proposition.echecs')} {(s.echecs ?? []).join(' · ')}
                  </p>
                )}
              </div>
            )}
            {s?.statut === "annulee" && (
              <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--muted-foreground)' }}>{t('companion.proposition.annulee')}</p>
            )}
            {s?.statut === "ajustee" && (
              <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--muted-foreground)' }}>{t('companion.proposition.ajustee')}</p>
            )}
            {s?.statut === "erreur" && s.cle && (
              <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--muted-foreground)' }}>{t(s.cle)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
