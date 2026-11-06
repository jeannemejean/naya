import { describe, it, expect } from 'vitest';
import { joursNecessaires, nombreBorne } from './salves';

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
