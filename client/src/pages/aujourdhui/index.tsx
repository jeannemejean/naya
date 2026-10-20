// L'accueil « Aujourd'hui » (spec refonte cocon, section 3, revue le 20 oct.) : la photo et le
// mot du matin avec la prochaine étape ; dessous, ta journée à gauche (le cœur de la page) et,
// à droite, la note pour Naya et les repères de la semaine.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { HeroSaison } from "@/components/cocon/HeroSaison";
import QuickCapture from "@/components/quick-capture";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/lib/project-context";
import { formatLocalDate } from "@/lib/dateUtils";
import { doitAllerALOnboarding, heureLocale, nonCocheesPassees, prochaineEtape } from "./logique";
import { MotDuMatin } from "./MotDuMatin";
import { PiluleEtape } from "./PiluleEtape";
import { Capsules } from "./Capsules";
import { FilDuJour } from "./FilDuJour";
import { estAgenda, sansJalons, useActionsTaches, type TacheJour } from "./useActionsTaches";

function semaineDe(d: Date): { lundi: string; dimanche: string } {
  const lundi = new Date(d);
  lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  return { lundi: formatLocalDate(lundi), dimanche: formatLocalDate(dimanche) };
}

/** L'heure qui avance : la prochaine étape et la ligne « maintenant » suivent sans recharger. */
function useMaintenant(): Date {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return maintenant;
}

export default function Aujourdhui({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { activeProjectId } = useProject();
  const { cocher, ouvrir, estOuvrable, projets, panneau } = useActionsTaches();

  const maintenant = useMaintenant();
  const today = formatLocalDate(maintenant);
  const heure = heureLocale(maintenant);
  const { lundi, dimanche } = semaineDe(maintenant);
  const dateDuJour = new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(maintenant);

  // Même clé et même adresse que todays-tasks.tsx : cache et cochage optimiste partagés.
  const tasksQueryKey = activeProjectId
    ? ["/api/tasks/range", { start: today, end: today, projectId: activeProjectId }]
    : ["/api/tasks/range", { start: today, end: today }];
  const tasksUrl = activeProjectId
    ? `/api/tasks/range?start=${today}&end=${today}&projectId=${activeProjectId}`
    : `/api/tasks/range?start=${today}&end=${today}`;
  const { data: tasks, isLoading, isError } = useQuery<TacheJour[]>({
    queryKey: tasksQueryKey,
    queryFn: async () => {
      const res = await fetch(tasksUrl, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
    refetchInterval: 2 * 60 * 1000,
    throwOnError: false, // le fil montre son propre état d'erreur, l'accueil reste debout
  });
  const taches = sansJalons(tasks ?? []);
  // Un événement d'agenda ne se « commence » pas dans Naya.
  const aFaire = taches.filter((x) => !estAgenda(x));
  const etape = prochaineEtape(aFaire, heure);
  const restantes = nonCocheesPassees(aFaire, heure).length;
  const miseEnAvant = etape && etape.moment !== "sansHeure"
    ? { id: etape.tache.id, libelle: t(etape.moment === "maintenant" ? "accueil.fil.enCours" : "accueil.fil.ensuite") }
    : null;

  const { data: enRetard } = useQuery<unknown[]>({
    queryKey: [`/api/tasks/overdue?clientToday=${today}`],
    retry: false,
    throwOnError: false,
  });

  // Garde reprise de l'ancien dashboard (même requête, même redirection) : un nouveau compte
  // sans ADN de marque part à l'onboarding. throwOnError: false, pas d'écran d'erreur pour une garde.
  const brandDna = useQuery({ queryKey: ["/api/brand-dna"], retry: false, throwOnError: false });
  useEffect(() => {
    if (doitAllerALOnboarding(brandDna)) window.location.href = "/onboarding";
  }, [brandDna.isSuccess, brandDna.data]);

  const prenom = user?.firstName?.trim();
  const etatFil = isLoading ? "chargement" : isError ? "erreur" : "pret";

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px]">
          <OngletsEspace />
          <main className="space-y-6 px-4 pb-10 pt-2 sm:px-6">
            <HeroSaison>
              {/* Texte à gauche, sur le voile ; le décor de saison vit à droite. */}
              <div className="flex min-h-[260px] flex-col px-5 py-6 text-primary-foreground sm:px-8 sm:py-7">
                <p className="text-[13px] first-letter:uppercase">{dateDuJour}</p>
                <h1 className="titre-accueil mt-2 break-words !text-primary-foreground">
                  {prenom ? t("accueil.bonjour", { prenom }) : t("accueil.bonjourSansPrenom")}
                </h1>
                <MotDuMatin className="mt-3" />
                {/* Rien tant que les tâches chargent ou si elles échouent ; aucune tâche : rien non plus. */}
                {etatFil === "pret" && aFaire.length > 0 && (
                  <div className="mt-auto pt-6">
                    <PiluleEtape etape={etape} restantes={restantes} onCommencer={(x) => ouvrir(x as TacheJour)} />
                  </div>
                )}
              </div>
            </HeroSaison>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                <FilDuJour
                  taches={taches}
                  etat={etatFil}
                  maintenant={heure}
                  miseEnAvant={miseEnAvant}
                  enAttente={Array.isArray(enRetard) ? enRetard.length : 0}
                  projets={projets}
                  onCocher={cocher}
                  onOuvrir={ouvrir}
                  estOuvrable={estOuvrable}
                />
              </div>
              <aside className="min-w-0 space-y-2 lg:sticky lg:top-4">
                <QuickCapture variante="pilule" />
                <Capsules aujourdhui={today} lundi={lundi} dimanche={dimanche} activeProjectId={activeProjectId} />
              </aside>
            </div>
          </main>
        </div>
      </div>
      {panneau}
    </div>
  );
}
