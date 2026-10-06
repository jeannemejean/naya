import { describe, it, expect, vi } from 'vitest';
import { deciderCochage } from './cochage-livrable';

const prod = { id: 1, title: 'Rédiger le post LinkedIn', completed: false };
const autre = { id: 2, title: 'Appeler Marie', completed: false };

describe('deciderCochage', () => {
  it('tâche hors production : cocher sans lire les livrables', async () => {
    const lire = vi.fn();
    expect(await deciderCochage(autre, lire)).toBe('cocher');
    expect(lire).not.toHaveBeenCalled();
  });
  it('tâche déjà terminée : cocher sans lire les livrables', async () => {
    const lire = vi.fn();
    expect(await deciderCochage({ ...prod, completed: true }, lire)).toBe('cocher');
    expect(lire).not.toHaveBeenCalled();
  });
  it('production sans livrable : demander', async () => {
    expect(await deciderCochage(prod, async () => [])).toBe('demander');
  });
  it('production avec un livrable : cocher', async () => {
    expect(await deciderCochage(prod, async () => [{}])).toBe('cocher');
  });
  it('lecture en erreur : cocher', async () => {
    expect(await deciderCochage(prod, async () => { throw new Error('réseau'); })).toBe('cocher');
  });
  it('lecture qui ne répond jamais : cocher après le délai', async () => {
    vi.useFakeTimers();
    try {
      const p = deciderCochage(prod, () => new Promise(() => {}), 1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await p).toBe('cocher');
    } finally {
      vi.useRealTimers();
    }
  });
});
