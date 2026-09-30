import { describe, it, expect } from 'vitest';
import { libelleAppelRevue } from './appel-revue';

const proposee = (id: number) => ({ id, status: 'proposed' });
const repondue = (id: number) => ({ id, status: 'answered' });
const gardee = (id: number) => ({ id, status: 'kept' });

describe('libelleAppelRevue — la ligne d’appel du dashboard', () => {
  it('trois fiches à lire → la ligne annonce trois choses à lire', () => {
    expect(libelleAppelRevue({ duJour: [proposee(1), proposee(2), proposee(3)] })).toBe(
      '3 choses à lire sur ton marché',
    );
  });

  it('une seule fiche → le singulier', () => {
    expect(libelleAppelRevue({ duJour: [proposee(1)] })).toBe('Une chose à lire sur ton marché');
  });

  it('matin vide → aucune ligne (ni carte vide, ni « 0 »)', () => {
    expect(libelleAppelRevue({ duJour: [] })).toBeNull();
  });

  it('QUE des fiches gardées → le dashboard reste muet : les gardées ne sont pas une dette', () => {
    // Le défaut fermé ici : avec une seule liste mêlant les gardées, ce cas affichait
    // « 4 choses à lire sur ton marché » tous les matins, indéfiniment.
    const donnees = { duJour: [], gardees: [gardee(1), gardee(2), gardee(3), gardee(4)] };
    expect(libelleAppelRevue(donnees)).toBeNull();
  });

  it('tout a reçu un avis → la ligne disparaît : c’est un déclencheur, pas un inventaire', () => {
    // « 3 choses à lire sur ton marché » quand les trois ont été lues et commentées est
    // simplement faux. Le nombre porte sur la journée seule : il retombe à zéro le soir,
    // il n'accumule rien — ce n'est pas pour autant un compteur de dette.
    const donnees = { duJour: [repondue(1), repondue(2), repondue(3)] };
    expect(libelleAppelRevue(donnees)).toBeNull();
  });

  it('deux répondues sur trois → la ligne n’annonce que celle qui reste', () => {
    const donnees = { duJour: [repondue(1), repondue(2), proposee(3)] };
    expect(libelleAppelRevue(donnees)).toBe('Une chose à lire sur ton marché');
  });

  it('des fiches du jour ET des gardées → seules celles du jour à lire sont comptées', () => {
    const donnees = { duJour: [proposee(1)], gardees: [gardee(2), gardee(3)] };
    expect(libelleAppelRevue(donnees)).toBe('Une chose à lire sur ton marché');
  });

  it('réponse absente (requête en erreur, repliée en silence) → aucune ligne', () => {
    expect(libelleAppelRevue(undefined)).toBeNull();
  });
});
