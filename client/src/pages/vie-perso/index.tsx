// Page « Vie perso » (option, espace Aujourd'hui) : repas de la semaine, activités, réglages.
// Spec : docs/superpowers/specs/2026-11-23-vie-perso-design.md
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { cn } from "@/lib/utils";
import { SemaineRepas } from "./SemaineRepas";
import { Activites } from "./Activites";
import { Reglages } from "./Reglages";

type Section = "semaine" | "activites" | "reglages";
const SECTIONS: Section[] = ["semaine", "activites", "reglages"];

export default function ViePerso({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("semaine");

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <OngletsEspace />
        <header className="bg-card border-b border-border px-6 py-4 flex-shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Heart className="h-5 w-5 text-naya-salvia" />
            {t("viePerso.titre")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("viePerso.description")}</p>
          <div className="mt-3 flex flex-wrap gap-2" role="tablist">
            {SECTIONS.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={section === s} onClick={() => setSection(s)}
                className={cn("rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  section === s ? "bg-naya-olive text-white" : "bg-naya-olive-06 text-naya-olive-70 hover:text-foreground")}
                data-testid={`vie-perso-section-${s}`}>
                {t(`viePerso.onglets.${s}`)}
              </button>
            ))}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-4xl mx-auto">
            {section === "semaine" && <SemaineRepas />}
            {section === "activites" && <Activites />}
            {section === "reglages" && <Reglages />}
          </div>
        </main>
      </div>
    </div>
  );
}
