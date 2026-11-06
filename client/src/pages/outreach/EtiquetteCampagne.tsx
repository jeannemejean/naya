// Étiquette de campagne de la boîte « Réponses » : pastille lisible, couleur stable par campagne.
import { couleurCampagne } from './reponses-logique';

export default function EtiquetteCampagne({ id, nom, className = '' }: { id: number; nom: string; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 ${couleurCampagne(id)} ${className}`}
      title={nom}
      data-testid="etiquette-campagne"
    >
      <span className="truncate">{nom}</span>
    </span>
  );
}
