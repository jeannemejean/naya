import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetchJson';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { ReadingQuery } from '@shared/schema';

interface Projet { id: number; name: string }

// Ce que Naya cherche, en clair, et corrigeable à la main. Une requête écrite ici
// (origin = manual) n'est jamais remplacée par la régénération hebdomadaire.
export function RequetesDeVeille() {
  const qc = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [brouillon, setBrouillon] = useState<Record<number, string>>({});
  const [nouvelle, setNouvelle] = useState<Record<number, string>>({});

  const { data } = useQuery<{ queries: ReadingQuery[] }>({
    queryKey: ['/api/reading/queries'],
    queryFn: () => fetchJson('/api/reading/queries'),
    enabled: ouvert,
  });
  const { data: projets } = useQuery<Projet[]>({
    queryKey: ['/api/projects'],
    queryFn: () => fetchJson('/api/projects'),
    enabled: ouvert,
  });

  const invalider = () => qc.invalidateQueries({ queryKey: ['/api/reading/queries'] });

  const modifier = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { query?: string; isActive?: boolean } }) =>
      fetchJson(`/api/reading/queries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: invalider,
  });

  const ajouter = useMutation({
    mutationFn: ({ projectId, query }: { projectId: number; query: string }) =>
      fetchJson('/api/reading/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, query }),
      }),
    onSuccess: invalider,
  });

  if (!ouvert) {
    return (
      <button
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        onClick={() => setOuvert(true)}
        data-testid="ouvrir-requetes-veille"
      >
        Ce que Naya surveille
      </button>
    );
  }

  const queries = data?.queries ?? [];

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Ce que Naya surveille</h3>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOuvert(false)}
          data-testid="fermer-requetes-veille"
        >
          Fermer
        </button>
      </div>

      {(projets ?? []).map((p) => (
        <div key={p.id} className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.name}</p>
          {queries.filter((q) => q.projectId === p.id).map((q) => (
            <div key={q.id} className="flex items-center gap-2">
              <Input
                className="h-8 text-sm"
                value={brouillon[q.id] ?? q.query}
                onChange={(e) => setBrouillon((b) => ({ ...b, [q.id]: e.target.value }))}
                onBlur={() => {
                  const v = (brouillon[q.id] ?? q.query).trim();
                  if (v && v !== q.query) modifier.mutate({ id: q.id, patch: { query: v } });
                }}
                data-testid={`requete-${q.id}`}
              />
              <Switch
                checked={q.isActive}
                onCheckedChange={(v) => modifier.mutate({ id: q.id, patch: { isActive: v } })}
                data-testid={`requete-active-${q.id}`}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              className="h-8 text-sm"
              placeholder="Ajouter une recherche…"
              value={nouvelle[p.id] ?? ''}
              onChange={(e) => setNouvelle((n) => ({ ...n, [p.id]: e.target.value }))}
              data-testid={`nouvelle-requete-${p.id}`}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!((nouvelle[p.id] ?? '').trim())}
              onClick={() => {
                ajouter.mutate({ projectId: p.id, query: (nouvelle[p.id] ?? '').trim() });
                setNouvelle((n) => ({ ...n, [p.id]: '' }));
              }}
              data-testid={`ajouter-requete-${p.id}`}
            >
              Ajouter
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
