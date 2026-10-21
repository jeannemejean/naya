// Le fil de la journée : les tâches d'aujourd'hui à leur heure, cochables d'un clic. Rien en
// rouge : les tâches d'avant restées non faites tiennent dans une ligne calme en bas.
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ListeTaches } from "./ListeTaches";
import type { TacheJour } from "./useActionsTaches";

export function FilDuJour({ taches, etat, maintenant, miseEnAvant, enAttente, projets, onCocher, onOuvrir, estOuvrable }: {
  taches: TacheJour[];
  etat: "chargement" | "erreur" | "pret";
  maintenant: string;
  miseEnAvant: { id: number; libelle: string } | null;
  enAttente: number;
  projets: Array<{ id: number; name: string; color?: string | null }>;
  onCocher: (t: TacheJour) => void;
  onOuvrir: (t: TacheJour) => void;
  estOuvrable: (t: TacheJour) => boolean;
}) {
  const { t } = useTranslation();
  const faites = taches.filter((x) => x.completed).length;

  return (
    <section aria-labelledby="fil-titre" className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="fil-titre" className="text-[22px] font-semibold leading-tight text-foreground">{t("accueil.fil.titre")}</h2>
        {etat === "pret" && taches.length > 0 && (
          <span className="text-[13px] tabular-nums text-muted-foreground">{t("accueil.fil.compte", { faites, total: taches.length })}</span>
        )}
      </div>

      {etat === "chargement" && (
        <div aria-hidden="true" className="mt-4 space-y-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-6 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />)}
        </div>
      )}
      {etat === "erreur" && <p className="mt-3 text-[16px] text-muted-foreground">{t("accueil.fil.erreur")}</p>}
      {etat === "pret" && taches.length === 0 && <p className="mt-3 text-[16px] text-muted-foreground">{t("accueil.fil.vide")}</p>}

      {etat === "pret" && taches.length > 0 && (
        <ListeTaches
          taches={taches}
          maintenant={maintenant}
          miseEnAvant={miseEnAvant}
          projets={projets}
          onCocher={onCocher}
          onOuvrir={onOuvrir}
          estOuvrable={estOuvrable}
        />
      )}

      {enAttente > 0 && (
        <p className="mt-4 border-t border-border pt-4 text-[16px] leading-[1.6] text-muted-foreground">
          {t("accueil.fil.enAttente", { count: enAttente })}{" "}
          <Link href="/semaine" className="rounded-sm font-semibold text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("accueil.fil.voirSemaine")}
          </Link>
        </p>
      )}
    </section>
  );
}

export default FilDuJour;
