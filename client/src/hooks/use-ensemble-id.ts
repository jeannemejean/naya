import { useState } from 'react';

/**
 * Un ensemble d'identifiants numériques « en cours » ou « déjà acquis », géré en mémoire
 * de composant. Sert de garde-fou léger là où une mutation react-query est PARTAGÉE par
 * plusieurs lignes d'une même liste (une carte, une requête de veille…) : react-query
 * n'expose qu'un seul `isPending`/`isSuccess` global par mutation, ce qui désactiverait ou
 * marquerait « fait » TOUTES les lignes dès qu'une seule est en cours — alors que chaque
 * ligne doit rester indépendante des autres.
 */
export function useEnsembleId() {
  const [ids, setIds] = useState<Set<number>>(new Set());

  const ajouter = (id: number) => setIds((s) => new Set(s).add(id));

  const retirer = (id: number) =>
    setIds((s) => {
      const suite = new Set(s);
      suite.delete(id);
      return suite;
    });

  return [ids, ajouter, retirer] as const;
}
