// Navigation des pages : la pilule des 5 espaces. Contrat gardé avec les pages, qui la posent
// en premier enfant de leur rangée flex : au-dessus de 768 px, une colonne de 76 px avec la
// pilule centrée en hauteur à 16 px du bord ; en dessous, la colonne disparaît et la pilule
// est fixe en bas de l'écran.
import PiluleNavigation from "@/components/navigation/PiluleNavigation";

interface SidebarProps {
  onSearchClick?: () => void;
}

export default function Sidebar({ onSearchClick }: SidebarProps) {
  return (
    <div className="shrink-0 md:flex md:h-full md:w-[76px] md:items-center md:pl-4">
      <PiluleNavigation onSearchClick={onSearchClick} />
    </div>
  );
}
