// Ce que l'agent a déjà fait côté serveur, avec un bouton « Annuler » tant que la fenêtre
// de 24 h est ouverte. Le panneau n'exécute rien lui-même.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ActionFaite } from "@shared/agent";
import { apiRequest } from "@/lib/queryClient";
import { doitInvalider, etatAnnulation, raisonDeErreur } from "./companion-logique";

const RAISONS = ["modifiee", "expiree", "deja_annulee", "introuvable"] as const;
type Suivi = { statut: "envoi" } | { statut: "annule" } | { statut: "erreur"; cle: string };

export const styleLigneAgent: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: '0.5625rem',
  letterSpacing: '0.02em',
  fontWeight: 300,
  lineHeight: 1.5,
};

export const styleBoutonAgent: React.CSSProperties = {
  ...styleLigneAgent,
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--foreground)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  flexShrink: 0,
};

export function ActionsFaites({ faites }: { faites: ActionFaite[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [suivi, setSuivi] = useState<Record<number, Suivi>>({});
  if (faites.length === 0) return null;

  const annuler = async (id: number) => {
    setSuivi((s) => ({ ...s, [id]: { statut: "envoi" } }));
    try {
      await apiRequest("POST", `/api/agent/actions/${id}/annuler`);
      setSuivi((s) => ({ ...s, [id]: { statut: "annule" } }));
      queryClient.invalidateQueries({ predicate: (q) => doitInvalider(q.queryKey) });
    } catch (err) {
      const raison = raisonDeErreur(err, RAISONS);
      setSuivi((s) => ({ ...s, [id]: { statut: "erreur", cle: `companion.annulation.${raison ?? "erreur"}` } }));
    }
  };

  const maintenant = new Date();
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {faites.map((f) => {
        const s = suivi[f.actionId];
        const annulable = etatAnnulation(f, maintenant) === "annulable";
        return (
          <div key={f.actionId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ ...styleLigneAgent, color: 'var(--accent)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ opacity: 0.6 }}>◆</span>
              <span style={{ flex: 1, textDecoration: s?.statut === "annule" ? 'line-through' : undefined }}>{f.resume}</span>
              {s?.statut === "annule" ? (
                <span style={{ color: 'var(--muted-foreground)' }}>{t('companion.annule')}</span>
              ) : annulable && s?.statut !== "erreur" ? (
                <button
                  type="button"
                  style={{ ...styleBoutonAgent, opacity: s?.statut === "envoi" ? 0.5 : 1 }}
                  disabled={s?.statut === "envoi"}
                  onClick={() => annuler(f.actionId)}
                >
                  {t('companion.annuler')}
                </button>
              ) : null}
            </div>
            {s?.statut === "erreur" && (
              <p style={{ ...styleLigneAgent, margin: 0, color: 'var(--muted-foreground)' }}>{t(s.cle)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
