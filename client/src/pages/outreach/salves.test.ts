import { describe, it, expect } from 'vitest';
import { compterPrets, joursNecessaires, nombreBorne, nombrePrerempli, raisonSalveImpossible, SALVE_NOMBRE_MAX } from './salves';
import { TAG_LEAD_TEST } from '@shared/mode-test';

describe('nombreBorne', () => {
  it('garde une saisie valide', () => {
    expect(nombreBorne('12', 20)).toBe(12);
  });
  it('ne dépasse jamais le maximum', () => {
    expect(nombreBorne('50', 20)).toBe(20);
  });
  it('vide, négatif ou illisible vaut 0', () => {
    expect(nombreBorne('', 20)).toBe(0);
    expect(nombreBorne('-3', 20)).toBe(0);
    expect(nombreBorne('abc', 20)).toBe(0);
  });
  it('arrondit une saisie décimale vers le bas', () => {
    expect(nombreBorne('3.7', 20)).toBe(3);
  });
});

describe('joursNecessaires', () => {
  it('compte les jours entamés', () => {
    expect(joursNecessaires(20, 5)).toBe(4);
    expect(joursNecessaires(21, 5)).toBe(5);
  });
  it('sans rythme : zéro jour', () => {
    expect(joursNecessaires(20, 0)).toBe(0);
  });
});

describe('« Lancer en salve »', () => {
  const valide = '2026-10-01T10:00:00Z';
  const p = (id: number, over: Record<string, unknown> = {}) =>
    ({ id, stage: 'messages_ready', validatedAt: valide, archivedAt: null, tags: [], ...over });

  it('ne compte que les prospects validés, contactables et jamais entrés en séquence', () => {
    const prospects = [
      p(1),
      p(2, { validatedAt: null }),                 // messages non validés
      p(3, { stage: 'new' }),                      // pas à l'étape contactable
      p(4),                                        // déjà en séquence (même en pause)
      p(5, { archivedAt: '2026-10-02' }),          // archivé
      p(6, { tags: [TAG_LEAD_TEST] }),             // prospect test
      p(7, { validatedAt: 'pas une date' }),       // validation illisible
      p(8),
    ];
    expect(compterPrets(prospects, new Set([4]))).toBe(2);
  });

  it('préremplit avec tous les prêts, plafonné à 100 comme le serveur', () => {
    expect(SALVE_NOMBRE_MAX).toBe(100);
    expect(nombrePrerempli(0)).toBe(0);
    expect(nombrePrerempli(37)).toBe(37);
    expect(nombrePrerempli(100)).toBe(100);
    expect(nombrePrerempli(250)).toBe(100);
  });

  it('le bouton est grisé, avec sa raison, quand personne n’est prêt', () => {
    expect(raisonSalveImpossible({ hasSequence: true, prets: 0 })).toBe('aucunPret');
    expect(raisonSalveImpossible({ hasSequence: false, prets: 12 })).toBe('sansSequence');
    expect(raisonSalveImpossible({ hasSequence: true, prets: 3 })).toBeNull();
  });
});
