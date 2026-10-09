import { describe, it, expect } from 'vitest';
import { deciderCochage } from './cochage-livrable';

const prod = { id: 1, title: 'Photographier 3 détails', completed: false };
const autre = { id: 2, title: 'Appeler le comptable', completed: false };

describe('deciderCochage — immédiat, sans réseau', () => {
  it('coche une tâche hors production', () => {
    expect(deciderCochage(autre, undefined)).toBe('cocher');
  });
  it('décoche toujours une tâche déjà terminée', () => {
    expect(deciderCochage({ ...prod, completed: true }, undefined)).toBe('cocher');
  });
  it('production sans livrable : ouvre le dépôt', () => {
    expect(deciderCochage(prod, [])).toBe('demander');
  });
  it('production avec livrable en cache : coche', () => {
    expect(deciderCochage(prod, [{}])).toBe('cocher');
  });
  it('production, livrables inconnus : ouvre le dépôt sans attendre', () => {
    expect(deciderCochage(prod, undefined)).toBe('demander');
  });
});
