// Le matin du fil conducteur (spec 2026-11-10, §3) : les 2 ou 3 tâches qui comptent le plus,
// en cartes, chacune avec son pourquoi et l'étape et l'objectif qu'elle sert.
import { useTranslation } from "react-i18next";
import type { TacheCle } from "@shared/fil";
import { texteLien } from "./fil-logique";

export function TachesCles({ taches, className }: { taches: TacheCle[]; className?: string }) {
  const { t } = useTranslation();
  if (taches.length === 0) return null;
  return (
    <section aria-labelledby="taches-cles-titre" className={className}>
      <h2 id="taches-cles-titre" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("filConducteur.matin.titre")}
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {taches.map((x, i) => {
          const lien = x.lien ? texteLien(x.lien, (cle, opts) => t(cle, opts)) : null;
          return (
            <li key={x.tacheId} className="flex min-w-0 flex-col rounded-carte bg-card p-4 shadow-cocon sm:p-5">
              <span aria-hidden="true" className="text-[13px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
              <p className="mt-1 break-words text-[17px] font-semibold leading-[1.35] text-foreground">{x.titre}</p>
              {x.pourquoi?.trim() && (
                <p className="mt-2 break-words text-[14px] leading-[1.5] text-muted-foreground">{x.pourquoi}</p>
              )}
              {lien && (
                <p className="mt-auto break-words pt-3 text-[12px] leading-[1.5] text-muted-foreground opacity-80">{lien}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default TachesCles;
