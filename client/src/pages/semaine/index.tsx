// « Semaine » : la vue de ta journée, pour les sept jours. Une bande des jours pour s'y
// retrouver d'un coup d'œil, puis chaque jour avec ses tâches, cochables comme sur Aujourd'hui.
// La grille horaire (glisser-déposer, pause du planning) reste à un clic : « Vue horaire ».
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { useProject } from "@/lib/project-context";
import { formatLocalDate } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { heureLocale } from "../aujourdhui/logique";
import { ListeTaches } from "../aujourdhui/ListeTaches";
import { sansJalons, useActionsTaches, type TacheJour } from "../aujourdhui/useActionsTaches";
import { joursDeLaSemaine, lundiDe, plusJours } from "./semaine";

const ROND = "flex h-11 w-11 items-center justify-center rounded-full bg-card text-foreground shadow-cocon transition-colors duration-150 hover:bg-muted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function Semaine({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const { activeProjectId } = useProject();
  const { cocher, ouvrir, estOuvrable, projets, panneau } = useActionsTaches();

  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const aujourdhui = formatLocalDate(maintenant);
  const lundiCourant = lundiDe(aujourdhui);
  const [lundi, setLundi] = useState(lundiCourant);
  const jours = useMemo(() => joursDeLaSemaine(lundi), [lundi]);
  const dimanche = jours[6];

  const url = `/api/tasks/range?start=${lundi}&end=${dimanche}${activeProjectId ? `&projectId=${activeProjectId}` : ""}`;
  const { data, isLoading, isError } = useQuery<TacheJour[]>({
    // Préfixe /api/tasks/range : suit le cochage optimiste et ses invalidations.
    queryKey: ["/api/tasks/range", { start: lundi, end: dimanche, ...(activeProjectId ? { projectId: activeProjectId } : {}) }],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
    throwOnError: false,
    placeholderData: (precedent) => precedent, // la semaine voisine arrive sans écran vide
  });
  const parJour = useMemo(() => {
    const m = new Map<string, TacheJour[]>(jours.map((j) => [j, []]));
    for (const x of sansJalons(data ?? [])) {
      const j = (x.scheduledDate ?? "").slice(0, 10);
      m.get(j)?.push(x);
    }
    return m;
  }, [data, jours]);
  const toutes = [...parJour.values()].flat();
  const faites = toutes.filter((x) => x.completed).length;

  const fmt = (j: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: "UTC" }).format(new Date(`${j}T12:00:00Z`));
  const titre = t("semaine.titre", { debut: fmt(lundi, { day: "numeric", month: lundi.slice(5, 7) === dimanche.slice(5, 7) ? undefined : "long" }), fin: fmt(dimanche, { day: "numeric", month: "long" }) });

  // Les jours passés sont repliés sur une ligne (aujourd'hui reste près du haut) ; un clic,
  // sur la ligne ou dans la bande des jours, les déplie.
  const [depliés, setDepliés] = useState<Set<string>>(new Set());
  const basculer = (j: string) => setDepliés((d) => { const n = new Set(d); n.has(j) ? n.delete(j) : n.add(j); return n; });
  const sections = useRef(new Map<string, HTMLElement>());
  const allerAuJour = (j: string) => {
    if (j < aujourdhui) setDepliés((d) => new Set(d).add(j));
    const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Après le rendu du jour déplié.
    requestAnimationFrame(() => sections.current.get(j)?.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" }));
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px]">
          <OngletsEspace />
          <main className="px-4 pb-10 pt-2 sm:px-6">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h1 className="font-['Lora'] text-[28px] font-medium leading-tight text-foreground [text-wrap:balance]">{titre}</h1>
                <p className="mt-1 text-[16px] text-muted-foreground">
                  {toutes.length > 0 ? t("semaine.compte", { faites, total: toutes.length }) : isLoading ? " " : t("semaine.vide")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lundi !== lundiCourant && (
                  <button type="button" onClick={() => setLundi(lundiCourant)} className="inline-flex h-11 items-center rounded-full bg-card px-4 text-[16px] font-semibold text-foreground shadow-cocon hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("semaine.cetteSemaine")}
                  </button>
                )}
                <button type="button" onClick={() => setLundi(plusJours(lundi, -7))} aria-label={t("semaine.precedente")} className={ROND}>
                  <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setLundi(plusJours(lundi, 7))} aria-label={t("semaine.suivante")} className={ROND}>
                  <ChevronRight className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>
                <Link href={`/planning?date=${lundi}&vue=semaine`} className="inline-flex h-11 items-center gap-2 rounded-full bg-card px-4 text-[16px] font-semibold text-foreground shadow-cocon hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Clock className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  <span>{t("semaine.vueHoraire")}</span>
                </Link>
              </div>
            </header>

            {/* La bande des jours : sept repères de même largeur, aujourd'hui en ancre sombre. */}
            <nav aria-label={t("semaine.jours")} className="sticky top-0 z-10 -mx-4 mt-5 bg-background/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
              <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {jours.map((j) => {
                  const ts = parJour.get(j) ?? [];
                  const fait = ts.filter((x) => x.completed).length;
                  const estAujourdhui = j === aujourdhui;
                  return (
                    <li key={j}>
                      <button
                        type="button"
                        onClick={() => allerAuJour(j)}
                        aria-current={estAujourdhui ? "date" : undefined}
                        className={cn(
                          "flex h-[68px] w-full flex-col items-center justify-center rounded-champ transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          estAujourdhui ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-cocon hover:bg-muted",
                        )}
                      >
                        <span className={cn("text-[13px] first-letter:uppercase", !estAujourdhui && "text-muted-foreground")}>{fmt(j, { weekday: "short" }).replace(".", "")}</span>
                        <span className="text-[17px] font-semibold leading-tight tabular-nums">{fmt(j, { day: "numeric" })}</span>
                        <span className={cn("text-[13px] tabular-nums", !estAujourdhui && "text-muted-foreground")}>{ts.length ? `${fait}/${ts.length}` : "·"}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {isError && <p className="mt-6 text-[16px] text-muted-foreground">{t("accueil.fil.erreur")}</p>}

            <div className="mt-4 space-y-4">
              {jours.map((j) => {
                const ts = parJour.get(j) ?? [];
                const estAujourdhui = j === aujourdhui;
                const passe = j < aujourdhui;
                const replie = passe && !depliés.has(j);
                const fait = ts.filter((x) => x.completed).length;
                const nomJour = fmt(j, { weekday: "long", day: "numeric", month: "long" });
                const compte = ts.length > 0 ? t("accueil.fil.compte", { faites: fait, total: ts.length }) : t("semaine.rienCeJour");
                return (
                  <section
                    key={j}
                    ref={(el) => { if (el) sections.current.set(j, el); else sections.current.delete(j); }}
                    aria-labelledby={`jour-${j}`}
                    // Marge de défilement : la bande collante ne recouvre pas le titre du jour.
                    className={cn("scroll-mt-[100px] rounded-carte bg-card shadow-cocon", replie ? "p-2" : "p-5 sm:p-6", estAujourdhui && "ring-2 ring-[var(--touche-1)]")}
                  >
                    {passe ? (
                      <h2 id={`jour-${j}`}>
                        <button
                          type="button"
                          onClick={() => basculer(j)}
                          aria-expanded={!replie}
                          className={cn("flex min-h-[44px] w-full items-center gap-3 rounded-champ text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", replie ? "px-3" : "-mx-1 mb-1 px-1")}
                        >
                          <span className={cn("flex-1 font-semibold leading-tight text-muted-foreground first-letter:uppercase", replie ? "text-[17px]" : "text-[22px]")}>{nomJour}</span>
                          <span className="text-[13px] tabular-nums text-muted-foreground">{compte}</span>
                          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", !replie && "rotate-180")} strokeWidth={1.75} />
                        </button>
                      </h2>
                    ) : (
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <h2 id={`jour-${j}`} className="flex items-center gap-2 text-[22px] font-semibold leading-tight text-foreground">
                          <span className="first-letter:uppercase">{nomJour}</span>
                          {estAujourdhui && (
                            <span className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold text-foreground" style={{ backgroundColor: "color-mix(in srgb, var(--touche-2) 45%, transparent)" }}>
                              {t("semaine.aujourdhui")}
                            </span>
                          )}
                        </h2>
                        {ts.length > 0 && <span className="text-[13px] tabular-nums text-muted-foreground">{compte}</span>}
                      </div>
                    )}
                    {replie ? null : isLoading && !data ? (
                      <div aria-hidden="true" className="mt-3 space-y-3">
                        {[0, 1].map((i) => <div key={i} className="h-6 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />)}
                      </div>
                    ) : ts.length === 0 ? (
                      <p className="text-[16px] text-muted-foreground">{t("semaine.rienCeJour")}</p>
                    ) : (
                      <ListeTaches
                        taches={ts}
                        maintenant={estAujourdhui ? heureLocale(maintenant) : null}
                        projets={projets}
                        onCocher={cocher}
                        onOuvrir={ouvrir}
                        estOuvrable={estOuvrable}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          </main>
        </div>
      </div>
      {panneau}
    </div>
  );
}
