// Les tâches d'une journée, dans l'ordre des heures : un rond pour cocher, la ligne pour
// ouvrir. Partagée par le fil d'Aujourd'hui et chaque jour de la Semaine. Sur la journée en
// cours, une ligne « maintenant » sépare ce qui est passé de ce qui vient.
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { estTacheProspection, indexMaintenant, trierFil } from "./logique";
import type { TacheJour } from "./useActionsTaches";

export function ListeTaches({ taches, maintenant, miseEnAvant, projets, onCocher, onOuvrir, estOuvrable }: {
  taches: TacheJour[];
  /** « HH:MM » sur la journée en cours ; null ailleurs (pas de ligne « maintenant »). */
  maintenant: string | null;
  /** La tâche proposée en « prochaine étape », avec son étiquette (« en cours », « ensuite »). */
  miseEnAvant?: { id: number; libelle: string } | null;
  projets: Array<{ id: number; name: string; color?: string | null }>;
  onCocher: (t: TacheJour) => void;
  onOuvrir: (t: TacheJour) => void;
  estOuvrable: (t: TacheJour) => boolean;
}) {
  const { t } = useTranslation();
  const fil = trierFil(taches);
  const posMaintenant = maintenant ? indexMaintenant(fil, maintenant) : -1;
  const nomProjet = (id: number | null | undefined) => (id ? projets.find((p) => p.id === id) : undefined);

  const ligneMaintenant = (
    <li key="maintenant" aria-hidden="true" className="flex items-center gap-3 py-1 pl-[60px] pr-2">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--touche-1)" }} />
      <span className="text-[13px] font-semibold tabular-nums text-foreground">{t("accueil.fil.maintenant", { heure: maintenant })}</span>
      <span className="h-px flex-1" style={{ backgroundColor: "var(--touche-1)", opacity: 0.5 }} />
    </li>
  );

  return (
    <ol className="-mx-2">
      {fil.map((tache, i) => {
        const enCours = tache.id === miseEnAvant?.id;
        const projet = nomProjet(tache.projectId);
        const ouvrable = estOuvrable(tache);
        return [
          i === posMaintenant ? ligneMaintenant : null,
          <li key={tache.id} className="group flex items-start gap-1 rounded-champ transition-colors duration-150 hover:bg-[rgba(239,231,217,0.55)] motion-reduce:transition-none">
            {/* Le rond : 44 px de cible, 22 px visibles. */}
            <button
              type="button"
              onClick={() => onCocher(tache)}
              aria-pressed={tache.completed}
              aria-label={t(tache.completed ? "accueil.fil.decocher" : "accueil.fil.cocher", { titre: tache.title })}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 motion-reduce:transition-none",
                  tache.completed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-[rgba(94,85,70,0.55)] text-transparent hover:border-primary hover:text-[rgba(46,42,36,0.35)]",
                )}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onOuvrir(tache)}
              disabled={!ouvrable}
              className="flex min-h-[44px] min-w-0 flex-1 items-start gap-3 rounded-champ py-2.5 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <span className={cn("w-11 shrink-0 text-[13px] leading-[1.6] tabular-nums", enCours ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {tache.scheduledTime ?? ""}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "line-clamp-2 break-words text-[16px] leading-[1.45]",
                    tache.completed ? "text-muted-foreground line-through decoration-[rgba(94,85,70,0.45)]" : "text-foreground",
                    enCours && "font-semibold",
                  )}
                >
                  {tache.title}
                </span>
                {(projet || estTacheProspection(tache) || enCours) && (
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                    {enCours && (
                      <span className="rounded-full px-2 py-px font-semibold text-foreground" style={{ backgroundColor: "color-mix(in srgb, var(--touche-2) 45%, transparent)" }}>
                        {miseEnAvant?.libelle}
                      </span>
                    )}
                    {projet && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: projet.color || "var(--touche-1)" }} />
                        <span className="truncate">{projet.name}</span>
                      </span>
                    )}
                    {estTacheProspection(tache) && <span>{t("accueil.fil.prospection")}</span>}
                  </span>
                )}
              </span>
            </button>
          </li>,
        ];
      })}
      {posMaintenant === fil.length && fil.length > 0 ? ligneMaintenant : null}
    </ol>
  );
}

export default ListeTaches;
