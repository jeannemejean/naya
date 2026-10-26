// « Ce que j'ai repris » (spec 2026-10-26-naya-reprise-intelligente-design.md) : ce que Naya a
// fait des tâches non faites — reformulées, découpées, fusionnées, archivées — avec son
// pourquoi et de quoi l'annuler. Les simples replacements tiennent dans une ligne repliée.
// Rien à dire, ou déjà vu : la carte n'est pas rendue.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, CalendarClock, CalendarX, ChevronDown, Combine, PenLine, Scissors, type LucideIcon } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface VueReprise {
  id: number;
  action: string;
  raison: string;
  titre: string;
  titreAvant: string | null;
  jour: string | null;
  sousTaches: string[];
  annulable: boolean;
  annulee: boolean;
}

const ICONES: Record<string, LucideIcon> = { reformuler: PenLine, decouper: Scissors, fusionner: Combine, post_reprogramme: CalendarClock, post_retire: CalendarX };
const CLE = ["/api/reprises"];

export function CarteReprise() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [ouverte, setOuverte] = useState(false);
  const { data } = useQuery<{ changements: VueReprise[]; replacees: VueReprise[] }>({ queryKey: CLE, retry: false, throwOnError: false });

  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: CLE });
    qc.invalidateQueries({ queryKey: ["/api/tasks/range"] });
    qc.invalidateQueries({ queryKey: ["/api/tasks"] });
  };
  const vue = useMutation({ mutationFn: () => apiRequest("POST", "/api/reprises/vues"), onSuccess: () => qc.setQueryData(CLE, { changements: [], replacees: [] }) });
  const annuler = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/reprises/${id}/annuler`), onSettled: rafraichir });

  const changements = data?.changements ?? [];
  const replacees = data?.replacees ?? [];
  if (changements.length === 0 && replacees.length === 0) return null;

  const jourCourt = (d: string) =>
    new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const archivee = (a: string) => a === "abandonner" || a === "perimee" || a === "fusionnee" || a === "post_retire";

  return (
    <section aria-labelledby="reprise-titre" className="mb-6 rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="reprise-titre" className="min-w-0 text-[22px] font-semibold leading-tight text-foreground">{t("accueil.reprise.titre")}</h2>
        <button
          type="button"
          onClick={() => vue.mutate()}
          className="min-h-[44px] shrink-0 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t("accueil.reprise.compris")}
        </button>
      </div>
      <p className="mt-1 text-[16px] leading-[1.5] text-muted-foreground">{t("accueil.reprise.chapo")}</p>

      {changements.length > 0 && (
        <ul className="mt-4 divide-y divide-border">
          {changements.map((c) => {
            const Icone = ICONES[c.action] ?? (archivee(c.action) ? Archive : PenLine);
            return (
              <li key={c.id} className={cn("grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 py-3 sm:grid-cols-[40px_minmax(0,1fr)_auto]", c.annulee && "opacity-60")}>
                <span aria-hidden="true" className="row-span-2 mt-0.5 flex sm:row-span-1 h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Icone className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-muted-foreground">
                    {t(`accueil.reprise.action.${c.action}`)}
                    {c.jour && !archivee(c.action) ? ` · ${jourCourt(c.jour)}` : ""}
                  </p>
                  <p className={cn("break-words text-[16px] leading-[1.45] text-foreground", archivee(c.action) && "line-through decoration-[rgba(94,85,70,0.45)]")}>{c.titre}</p>
                  {c.titreAvant && <p className="break-words text-[13px] text-muted-foreground">{t("accueil.reprise.avant", { titre: c.titreAvant })}</p>}
                  {c.sousTaches.length > 0 && (
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[14px] text-foreground">
                      {c.sousTaches.map((s, i) => <li key={i} className="break-words">{s}</li>)}
                    </ol>
                  )}
                  {c.raison && <p className="mt-1 text-[14px] leading-[1.5] text-muted-foreground">{c.raison}</p>}
                </div>
                {c.annulee ? (
                  <span className="col-start-2 py-2 text-[13px] text-muted-foreground sm:col-start-3 sm:row-start-1 sm:px-3 sm:py-3">{t("accueil.reprise.annule")}</span>
                ) : c.annulable && (
                  <button
                    type="button"
                    onClick={() => annuler.mutate(c.id)}
                    disabled={annuler.isPending && annuler.variables === c.id}
                    aria-label={t(archivee(c.action) ? "accueil.reprise.restaurerLabel" : "accueil.reprise.annulerLabel", { titre: c.titre })}
                    className="col-start-2 -ml-3 min-h-[44px] justify-self-start rounded-full px-3 text-[14px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:col-start-3 sm:row-start-1 sm:ml-0"
                  >
                    {t(archivee(c.action) ? "accueil.reprise.restaurer" : "accueil.reprise.annuler")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {replacees.length > 0 && (
        <div className={cn(changements.length > 0 && "border-t border-border", "mt-1 pt-1")}>
          <button
            type="button"
            onClick={() => setOuverte((o) => !o)}
            aria-expanded={ouverte}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-champ text-left text-[16px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{t("accueil.reprise.replacees", { count: replacees.length })}</span>
            <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", ouverte && "rotate-180")} />
          </button>
          {ouverte && (
            <ul className="pb-1">
              {replacees.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[14px]">
                  <span className="min-w-0 break-words text-foreground">{r.titre}</span>
                  {r.jour && <span className="shrink-0 text-muted-foreground">{jourCourt(r.jour)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default CarteReprise;
