// Le lot 4 du fil conducteur au matin (spec 2026-11-10, §7 et §8), sous les tâches clés : les
// pannes des tâches de fond, ce qui attend une suite (lundi), les chantiers à l'arrêt, la liste
// à trancher (vendredi, trois gestes), la création (alertes, à valider) et la ligne courte des
// indicateurs avec son détail repliable. Les libellés viennent du serveur, déjà rédigés ; ici on
// ne fait que les montrer. Naya ne tranche jamais seule : chaque geste part d'un bouton.
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ligneIndicateurs, type Indicateur, type MatinFil } from "@shared/fil";
import { apiRequest } from "@/lib/queryClient";
import { formatLocalDate } from "@/lib/dateUtils";
import {
  CLE_FIL_MATIN, codeErreur, cleErreurTrancher, corpsTrancher, detailIndicateur, joursTravaillesApres, textePanne,
  type GesteTrancher,
} from "./fil-logique";

export const carte = "rounded-carte bg-card p-5 shadow-cocon sm:p-6";
export const titreCarte = "text-[22px] font-semibold leading-tight text-foreground";
export const boutonPrincipal =
  "inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
export const boutonSecondaire =
  "inline-flex min-h-[44px] items-center rounded-full px-4 text-[15px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const lienLigne =
  "break-words text-[16px] leading-[1.45] text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
const liste = "mt-3 divide-y divide-border";
const ligne = "py-3 first:pt-0 last:pb-0";

/** Une carte titrée avec une liste de lignes. */
function CarteListe({ id, titre, chapo, children }: { id: string; titre: string; chapo?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={carte}>
      <h2 id={id} className={titreCarte}>{titre}</h2>
      {chapo && <p className="mt-1 text-[16px] leading-[1.5] text-muted-foreground">{chapo}</p>}
      <ul className={liste}>{children}</ul>
    </section>
  );
}

export function Pannes({ pannes }: { pannes: NonNullable<MatinFil["pannes"]> }) {
  const { t } = useTranslation();
  const maintenant = new Date();
  return (
    <CarteListe id="pannes-titre" titre={t("filConducteur.matin.pannes.titre")}>
      {pannes.map((p) => (
        <li key={p.nom} className={ligne}>
          <p className="break-words text-[16px] leading-[1.45] text-foreground">{textePanne(p, maintenant, (c, o) => t(c, o))}</p>
        </li>
      ))}
    </CarteListe>
  );
}

/** Lundi : chaque ligne mène là où la suite se donne. */
export function Reconciliation({ lignes }: { lignes: NonNullable<MatinFil["reconciliation"]> }) {
  const { t } = useTranslation();
  return (
    <CarteListe id="reconciliation-titre" titre={t("filConducteur.matin.reconciliation.titre")} chapo={t("filConducteur.matin.reconciliation.chapo")}>
      {lignes.map((r, i) => (
        <li key={`${r.source}-${i}`} className={ligne}>
          <Link href={r.lien} className={lienLigne}>{r.libelle}</Link>
        </li>
      ))}
    </CarteListe>
  );
}

export function ChantiersBloques({ chantiers }: { chantiers: NonNullable<MatinFil["chantiersBloques"]> }) {
  const { t } = useTranslation();
  return (
    <CarteListe id="chantiers-titre" titre={t("filConducteur.matin.chantiers.titre")}>
      {chantiers.map((c) => (
        <li key={c.libelle} className={ligne}>
          <p className="break-words text-[16px] leading-[1.45] text-foreground">
            {t("filConducteur.matin.chantiers.ligne", { libelle: c.libelle, jours: c.joursSansMouvement })}
          </p>
          <p className="mt-1 break-words text-[14px] leading-[1.5] text-muted-foreground">{t("filConducteur.matin.chantiers.prochainPas", { pas: c.prochainPas })}</p>
        </li>
      ))}
    </CarteListe>
  );
}

export function CreationAlertes({ alertes }: { alertes: string[] }) {
  const { t } = useTranslation();
  return (
    <CarteListe id="creation-alertes-titre" titre={t("filConducteur.matin.creation.alertesTitre")}>
      {alertes.map((a) => (
        <li key={a} className={ligne}><p className="break-words text-[16px] leading-[1.45] text-foreground">{a}</p></li>
      ))}
    </CarteListe>
  );
}

export function AValider({ elements }: { elements: { libelle: string; lien: string }[] }) {
  const { t } = useTranslation();
  return (
    <CarteListe id="a-valider-titre" titre={t("filConducteur.matin.creation.aValiderTitre")}>
      {elements.map((v, i) => (
        <li key={`${v.lien}-${i}`} className={ligne}><Link href={v.lien} className={lienLigne}>{v.libelle}</Link></li>
      ))}
    </CarteListe>
  );
}

// ── Vendredi : à trancher ─────────────────────────────────────────────────────────────

export type Tranchee = { titre: string; geste: GesteTrancher };

function rafraichirApresGeste(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: CLE_FIL_MATIN });
  qc.invalidateQueries({ queryKey: ["/api/tasks/range"] });
  qc.invalidateQueries({ queryKey: ["/api/tasks"] });
}

/**
 * La liste du vendredi. Une tâche tranchée sort de la liste au rechargement du matin ; sa ligne
 * de confirmation est gardée par le parent (`tranchees`) pour ne pas disparaître sans un mot.
 */
export function Cloture({ taches, tranchees, onTranchee }: {
  taches: NonNullable<MatinFil["cloture"]>; tranchees: Record<number, Tranchee>; onTranchee: (id: number, t: Tranchee) => void;
}) {
  const { t } = useTranslation();
  const ouvertes = taches.filter((x) => !tranchees[x.tacheId]);
  const faites = Object.entries(tranchees);
  return (
    <CarteListe id="cloture-titre" titre={t("filConducteur.matin.cloture.titre")} chapo={ouvertes.length > 0 ? t("filConducteur.matin.cloture.chapo") : undefined}>
      {ouvertes.map((x) => <LigneATrancher key={x.tacheId} tache={x} onTranchee={onTranchee} />)}
      {faites.map(([id, r]) => (
        <li key={`fait-${id}`} className={ligne} role="status">
          <p className="break-words text-[16px] leading-[1.45] text-foreground">{r.titre}</p>
          <p className="mt-1 text-[14px] font-semibold text-foreground">{t(`filConducteur.matin.cloture.${GESTE_FAIT[r.geste]}`)}</p>
        </li>
      ))}
    </CarteListe>
  );
}

const GESTE_FAIT: Record<GesteTrancher, string> = { faire: "faite", deplacer: "deplacee", abandonner: "abandonnee" };

function LigneATrancher({ tache, onTranchee }: { tache: NonNullable<MatinFil["cloture"]>[number]; onTranchee: (id: number, t: Tranchee) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const aujourdhui = formatLocalDate(new Date());
  const [choixDate, setChoixDate] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const geste = useMutation({
    mutationFn: (g: { geste: GesteTrancher; date?: string }) => apiRequest("POST", "/api/fil/trancher", corpsTrancher(tache.tacheId, g.geste, g.date)),
    onSuccess: (_r, g) => {
      onTranchee(tache.tacheId, { titre: tache.titre, geste: g.geste });
      rafraichirApresGeste(qc);
    },
    onError: (e) => {
      const code = codeErreur(e);
      // Déjà réglée ailleurs : la liste se met à jour.
      if (code === "deja_tranchee" || code === "task_not_found") rafraichirApresGeste(qc);
      setErreur(cleErreurTrancher(code));
    },
  });
  const occupe = geste.isPending;
  const lancer = (g: GesteTrancher, date?: string) => { setErreur(null); geste.mutate({ geste: g, date }); };
  const idDate = `cloture-date-${tache.tacheId}`;

  return (
    <li className={ligne}>
      <p className="break-words text-[16px] leading-[1.45] text-foreground">{tache.titre}</p>
      <p className="mt-0.5 text-[14px] leading-[1.5] text-muted-foreground">{t("filConducteur.matin.cloture.ouverteDepuis", { n: tache.ouverteDepuis })}</p>
      {erreur && <p role="alert" className="mt-2 text-[14px] leading-[1.5] text-foreground">{t(erreur)}</p>}
      {choixDate == null ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={boutonPrincipal} disabled={occupe} onClick={() => lancer("faire")}>
            {t(occupe ? "filConducteur.matin.cloture.enCours" : "filConducteur.matin.cloture.faire")}
          </button>
          <button type="button" className={boutonSecondaire} disabled={occupe}
            onClick={() => { setErreur(null); setChoixDate(joursTravaillesApres(aujourdhui, 1)[0] ?? aujourdhui); }}>
            {t("filConducteur.matin.cloture.deplacer")}
          </button>
          <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => lancer("abandonner")}>
            {t("filConducteur.matin.cloture.abandonner")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label htmlFor={idDate} className="flex flex-col gap-1 text-[14px] text-muted-foreground">
            {t("filConducteur.matin.cloture.date")}
            <input id={idDate} type="date" value={choixDate} min={aujourdhui} onChange={(e) => setChoixDate(e.target.value)}
              className="min-h-[44px] rounded-md border border-border bg-card px-3 text-[15px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <button type="button" className={boutonPrincipal} disabled={occupe || !choixDate || choixDate < aujourdhui} onClick={() => lancer("deplacer", choixDate)}>
            {t(occupe ? "filConducteur.matin.cloture.enCours" : "filConducteur.matin.cloture.valider")}
          </button>
          <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => { setErreur(null); setChoixDate(null); }}>
            {t("filConducteur.matin.cloture.retour")}
          </button>
        </div>
      )}
    </li>
  );
}

// ── Indicateurs : une ligne, et le détail replié dessous ─────────────────────────────

export function Indicateurs({ indicateurs }: { indicateurs: Indicateur[] }) {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const resume = ligneIndicateurs(indicateurs);
  const idDetail = "indicateurs-detail";
  return (
    <section aria-labelledby="indicateurs-titre" className={carte}>
      <h2 id="indicateurs-titre" className="text-[14px] font-semibold uppercase tracking-wide text-muted-foreground">{t("filConducteur.matin.indicateurs.titre")}</h2>
      {resume && <p className="mt-1 break-words text-[16px] leading-[1.5] text-foreground">{resume}</p>}
      <button type="button" className={`${boutonSecondaire} -ml-4 mt-1`} aria-expanded={ouvert} aria-controls={idDetail} onClick={() => setOuvert((o) => !o)}>
        {t(ouvert ? "filConducteur.matin.indicateurs.masquerDetail" : "filConducteur.matin.indicateurs.voirDetail")}
      </button>
      {ouvert && (
        <dl id={idDetail} className="mt-2 divide-y divide-border">
          {indicateurs.map((i) => {
            const d = detailIndicateur(i, (c, o) => t(c, o));
            return (
              <div key={i.cle} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                <dt className="min-w-0 break-words text-[15px] leading-[1.45] text-foreground">{i.libelle}</dt>
                <dd className="text-right text-[15px] leading-[1.45] text-foreground">
                  <span className={i.indisponible || i.valeur == null ? "text-muted-foreground" : "font-semibold"}>{d.valeur}</span>
                  {d.avant && <span className="ml-2 text-[14px] text-muted-foreground">{d.avant}</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
