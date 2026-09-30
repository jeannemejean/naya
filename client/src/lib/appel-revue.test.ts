import { describe, it, expect } from 'vitest';
import { libelleAppelRevue } from './appel-revue';

const fiche = (id: number) => ({ id });

describe('libelleAppelRevue — la ligne d’appel du dashboard', () => {
  it('trois fiches du jour → la ligne annonce trois choses à lire', () => {
    expect(libelleAppelRevue({ duJour: [fiche(1), fiche(2), fiche(3)] })).toBe('3 choses à lire sur ton marché');
  });

  it('une seule fiche → le singulier', () => {
    expect(libelleAppelRevue({ duJour: [fiche(1)] })).toBe('Une chose à lire sur ton marché');
  });

  it('matin vide → aucune ligne (ni carte vide, ni « 0 »)', () => {
    expect(libelleAppelRevue({ duJour: [] })).toBeNull();
  });

  it('QUE des fiches gardées → le dashboard reste muet : les gardées ne sont pas une dette', () => {
    // Le défaut fermé ici : avec une seule liste mêlant les gardées, ce cas affichait
    // « 4 choses à lire sur ton marché » tous les matins, indéfiniment.
    const donnees = { duJour: [], gardees: [fiche(1), fiche(2), fiche(3), fiche(4)] };
    expect(libelleAppelRevue(donnees)).toBeNull();
  });

  it('des fiches du jour ET des gardées → seules celles du jour sont comptées', () => {
    const donnees = { duJour: [fiche(1)], gardees: [fiche(2), fiche(3)] };
    expect(libelleAppelRevue(donnees)).toBe('Une chose à lire sur ton marché');
  });

  it('réponse absente (requête en erreur, repliée en silence) → aucune ligne', () => {
    expect(libelleAppelRevue(undefined)).toBeNull();
  });
});
