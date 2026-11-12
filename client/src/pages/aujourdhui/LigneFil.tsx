// Sous une tâche : à quoi elle sert (son « pourquoi », en une ligne) et, plus discret, l'étape et
// l'objectif qu'elle fait avancer (fil conducteur, spec §3). Rien à dire : rien n'est rendu.
import { useTranslation } from "react-i18next";
import type { LienFil } from "@shared/fil";
import { cn } from "@/lib/utils";
import { texteLien } from "./fil-logique";

export function LigneFil({ pourquoi, lien, barree, className }: {
  pourquoi?: string | null;
  lien?: LienFil | null;
  /** Tâche faite : le fil s'efface avec elle. */
  barree?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const raison = pourquoi?.trim();
  if (!raison && !lien) return null;
  const texte = lien ? texteLien(lien, (cle, opts) => t(cle, opts)) : null;

  return (
    <span className={cn("mt-1 block min-w-0", barree && "opacity-60", className)}>
      {raison && (
        <span className="block truncate text-[14px] leading-[1.5] text-muted-foreground" title={raison}>{raison}</span>
      )}
      {texte && (
        <span className="block truncate text-[12px] leading-[1.5] text-muted-foreground opacity-80" title={texte}>{texte}</span>
      )}
    </span>
  );
}

export default LigneFil;
