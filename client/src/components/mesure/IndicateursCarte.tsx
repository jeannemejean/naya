// Les indicateurs du dernier mois saisi, avec leur évolution. Une donnée manquante s'affiche
// comme telle : jamais un zéro.
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { BAISSE_FAVORABLE, GENRE, formater, formaterEcart, libelleMois, type Indicateur, type Mois } from "./types";

const ORDRE: Indicateur[] = ["mer", "cac", "ca", "nouveaux_clients", "panier_moyen", "part_ca_nouveaux", "marge_contributive", "depense_totale"];

export default function IndicateursCarte({ mois }: { mois: Mois }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{t("mesure.indicateurs.titre", { mois: libelleMois(mois.mois, i18n.language) })}</h2>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        {ORDRE.map((ind) => {
          const v = formater(mois.indicateurs[ind], GENRE[ind], i18n.language);
          const e = mois.evolutions[ind];
          const ecart = formaterEcart(e?.precedent ?? null, i18n.language);
          const bon = e?.precedent != null && (BAISSE_FAVORABLE[ind] ? e.precedent < 0 : e.precedent > 0);
          return (
            <Card key={ind} className="p-3 space-y-0.5">
              <p className="text-[11px] text-muted-foreground">{t(`mesure.indicateurs.${ind}.nom`)}</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{v ?? <span className="text-sm font-normal text-muted-foreground">{t("mesure.indicateurs.manque")}</span>}</p>
              {ecart && (
                <p className={`text-[11px] tabular-nums ${bon ? "text-naya-salvia" : "text-naya-mauve"}`}>{t("mesure.indicateurs.vsPrecedent", { ecart })}</p>
              )}
              {!v && <p className="text-[10px] text-muted-foreground">{t(`mesure.indicateurs.${ind}.besoin`)}</p>}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
