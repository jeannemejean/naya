// Le fil de la journée : les tâches d'aujourd'hui à leur heure. Rien en rouge : les tâches
// d'avant restées non faites tiennent dans une ligne calme en bas.
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { estTacheProspection, ligneEnAttente, trierFil, type TacheAccueil } from "./logique";

export function FilDuJour({ taches, etat, enCoursId, enAttente, estOuvrable, onOuvrir }: {
  taches: TacheAccueil[];
  etat: "chargement" | "erreur" | "pret";
  enCoursId: number | null;
  enAttente: number;
  estOuvrable: (t: TacheAccueil) => boolean;
  onOuvrir: (t: TacheAccueil) => void;
}) {
  const { t } = useTranslation();
  const fil = trierFil(taches);

  return (
    <section aria-labelledby="fil-titre" className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <h2 id="fil-titre" className="text-[17px] font-semibold text-foreground">{t("accueil.fil.titre")}</h2>

      {etat === "chargement" && (
        <div aria-hidden="true" className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />)}
        </div>
      )}
      {etat === "erreur" && <p className="mt-3 text-[16px] text-muted-foreground">{t("accueil.fil.erreur")}</p>}
      {etat === "pret" && fil.length === 0 && <p className="mt-3 text-[16px] text-muted-foreground">{t("accueil.fil.vide")}</p>}

      {etat === "pret" && fil.length > 0 && (
        <ol className="mt-3">
          {fil.map((tache) => {
            const enCours = tache.id === enCoursId;
            const contenu = (
              <>
                <span className="w-12 shrink-0 pt-0.5 text-[13px] tabular-nums text-muted-foreground">{tache.scheduledTime ?? ""}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-[9px] h-2 w-2 shrink-0 rounded-full",
                    enCours ? "" : tache.completed ? "bg-[rgba(94,85,70,0.4)]" : "border border-muted-foreground",
                  )}
                  style={enCours ? { backgroundColor: "var(--touche-1)" } : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "line-clamp-2 break-words text-[16px] leading-[1.6]",
                      tache.completed ? "text-muted-foreground line-through decoration-[rgba(94,85,70,0.5)]" : "text-foreground",
                      enCours && "font-semibold",
                    )}
                  >
                    {tache.title}
                  </span>
                  {enCours && <span className="sr-only">{` (${t("accueil.fil.enCours")})`}</span>}
                  {tache.completed && <span className="sr-only">{` (${t("accueil.fil.faite")})`}</span>}
                </span>
                {estTacheProspection(tache) && (
                  <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[13px] text-muted-foreground">
                    {t("accueil.fil.prospection")}
                  </span>
                )}
              </>
            );
            const ligne = "flex w-full min-h-[44px] items-start gap-3 rounded-xl px-2 py-2 text-left";
            return (
              <li key={tache.id}>
                {estOuvrable(tache) ? (
                  <button
                    type="button"
                    onClick={() => onOuvrir(tache)}
                    className={cn(ligne, "transition-colors duration-150 hover:bg-[rgba(239,231,217,0.6)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                  >
                    {contenu}
                  </button>
                ) : (
                  <div className={ligne}>{contenu}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {ligneEnAttente(enAttente) && (
        <p className="mt-4 border-t border-border pt-4 text-[16px] leading-[1.6] text-muted-foreground">
          {t("accueil.fil.enAttente", { count: enAttente })}{" "}
          <Link href="/planning" className="font-semibold text-foreground underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("accueil.fil.voirSemaine")}
          </Link>
        </p>
      )}
    </section>
  );
}

export default FilDuJour;
