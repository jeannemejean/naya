// Page PUBLIQUE d'un rapport client (lien privé, sans compte). Sobre, au nom de l'agence — rien
// de Naya — et imprimable : « Enregistrer en PDF » passe par l'impression du navigateur.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface RapportPublic {
  client: string; agence: string; mois: string; langue: "fr" | "en";
  sections: Record<string, string>;
  chiffres: { indicateurs: Record<string, number | null>; evolutions: Record<string, number | null> } | null;
  contenus: { total: number; meilleurs: Array<{ titre: string; plateforme: string; date: string }> } | null;
  prospection: { envoyes: number; reponses: number } | null;
}

const SECTIONS = ["synthese", "realise", "resultats", "prochainesEtapes"];
const CHIFFRES: Array<{ cle: string; genre: "euros" | "nombre" | "ratio" }> = [
  { cle: "ca", genre: "euros" }, { cle: "nouveaux_clients", genre: "nombre" }, { cle: "depense_totale", genre: "euros" },
  { cle: "mer", genre: "ratio" }, { cle: "cac", genre: "euros" }, { cle: "panier_moyen", genre: "euros" },
];

export default function RapportPublic({ params }: { params: { jeton: string } }) {
  const { t: tVisiteur, i18n } = useTranslation();
  const [etat, setEtat] = useState<"chargement" | "indisponible" | RapportPublic>("chargement");

  useEffect(() => {
    fetch(`/api/public/rapports/${encodeURIComponent(params.jeton)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEtat(j ?? "indisponible"))
      .catch(() => setEtat("indisponible"));
  }, [params.jeton]);

  const fmt = (v: number, genre: string, lg: string) =>
    genre === "euros" ? v.toLocaleString(lg, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
      : genre === "ratio" ? v.toLocaleString(lg, { maximumFractionDigits: 1 })
      : v.toLocaleString(lg);
  const evo = (x: number | null | undefined) => (x == null ? "" : ` (${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)} %)`);

  if (etat === "chargement") return <div className="min-h-screen bg-white" />;
  const t = typeof etat === "object" ? i18n.getFixedT(etat.langue) : tVisiteur;
  const langue = typeof etat === "object" ? etat.langue : i18n.language;
  if (etat === "indisponible") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <p className="text-sm text-neutral-600">{t("rapports.public.indisponible")}</p>
      </div>
    );
  }
  const r = etat;
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <main className="max-w-2xl mx-auto px-6 py-12 print:py-0">
        <div className="flex items-start justify-between gap-4 mb-10">
          <div>
            {r.agence && <p className="text-xs uppercase tracking-widest text-neutral-500">{r.agence}</p>}
            <h1 className="text-2xl font-semibold mt-1">{t("rapports.public.titre", { client: r.client })}</h1>
            <p className="text-sm text-neutral-600 capitalize">
              {new Date(`${r.mois}-15T12:00:00Z`).toLocaleDateString(langue, { month: "long", year: "numeric" })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="print:hidden text-sm border border-neutral-300 rounded-md px-3 py-1.5 hover:bg-neutral-50"
          >
            {t("rapports.public.pdf")}
          </button>
        </div>

        {(r.chiffres || r.contenus || r.prospection) && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">{t("rapports.public.chiffres")}</h2>
            <table className="w-full text-sm">
              <tbody>
                {r.chiffres && CHIFFRES.filter((c) => r.chiffres!.indicateurs[c.cle] != null).map((c) => (
                  <tr key={c.cle} className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-600">{t(`rapports.public.indicateurs.${c.cle}`)}</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmt(r.chiffres!.indicateurs[c.cle]!, c.genre, langue)}
                      <span className="text-neutral-500 font-normal">{evo(r.chiffres!.evolutions[c.cle])}</span>
                    </td>
                  </tr>
                ))}
                {r.contenus && (
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-600">{t("rapports.public.contenus")}</td>
                    <td className="py-1.5 text-right font-medium">{r.contenus.total}</td>
                  </tr>
                )}
                {r.prospection && (
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-600">{t("rapports.public.prospection")}</td>
                    <td className="py-1.5 text-right font-medium">{t("rapports.public.prospectionValeur", { envoyes: r.prospection.envoyes, reponses: r.prospection.reponses })}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {SECTIONS.filter((k) => r.sections?.[k]).map((k) => (
          <section key={k} className="mb-7 break-inside-avoid">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-2">{t(`rapports.sections.${k}`)}</h2>
            <p className="text-[15px] leading-relaxed whitespace-pre-line">{r.sections[k]}</p>
          </section>
        ))}
      </main>
    </div>
  );
}
