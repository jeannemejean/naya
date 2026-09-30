import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetchJson';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useEnsembleId } from '@/hooks/use-ensemble-id';
import type { ReadingQuery } from '@shared/schema';

interface Projet { id: number; name: string }

// Ce que Naya cherche, en clair, et corrigeable à la main. Une requête écrite ici
// (origin = manual) n'est jamais remplacée par la régénération hebdomadaire.
export function RequetesDeVeille() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ouvert, setOuvert] = useState(false);
  const [brouillon, setBrouillon] = useState<Record<number, string>>({});
  const [nouvelle, setNouvelle] = useState<Record<number, string>>({});

  const [modifierEnCours, marquerModifierEnCours, retirerModifierEnCours] = useEnsembleId();
  const [ajouterEnCours, marquerAjouterEnCours, retirerAjouterEnCours] = useEnsembleId();

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

  const signalerEchec = (description: string) =>
    toast({ title: 'Non enregistré', description, variant: 'destructive' });

  const modifier = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { query?: string; isActive?: boolean } }) =>
      fetchJson(`/api/reading/queries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onMutate: ({ id }) => marquerModifierEnCours(id),
    onSuccess: invalider,
    onError: () => signalerEchec('La requête n’a pas été mise à jour : réessaie.'),
    onSettled: (_data, _erreur, { id, patch }) => {
      retirerModifierEnCours(id);
      // Seule une modification de TEXTE doit effacer le brouillon local, qu'elle réussisse
      // ou échoue : le champ doit retomber sur la vérité serveur (`brouillon[id] ?? q.query`),
      // jamais rester figé sur une saisie que le serveur a refusée ou n'a jamais reçue. Un
      // changement d'activation (isActive) ne porte pas sur ce champ et ne doit pas écraser
      // une saisie en cours, non encore validée par un blur — d'où la clé retirée, pas mise
      // à '' : mettre '' écraserait l'affichage au lieu de le laisser retomber sur q.query.
      if (patch.query !== undefined) {
        setBrouillon((b) => {
          const { [id]: _retire, ...reste } = b;
          return reste;
        });
      }
    },
  });

  const ajouter = useMutation({
    mutationFn: ({ projectId, query }: { projectId: number; query: string }) =>
      fetchJson('/api/reading/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, query }),
      }),
    onMutate: ({ projectId }) => marquerAjouterEnCours(projectId),
    onSuccess: invalider,
    onError: (_erreur, { projectId, query }) => {
      // La saisie a été vidée au clic, avant de connaître l'issue : en cas d'échec, on la
      // restitue pour ne pas faire perdre ce que l'utilisatrice venait de taper.
      setNouvelle((n) => ({ ...n, [projectId]: query }));
      signalerEchec('La recherche n’a pas été ajoutée : réessaie.');
    },
    onSettled: (_data, _erreur, { projectId }) => retirerAjouterEnCours(projectId),
  });

  if (!ouvert) {
    return (
      <button
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        onClick={() => setOuvert(true)}
        aria-expanded={false}
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
          aria-expanded={true}
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
                disabled={modifierEnCours.has(q.id)}
                aria-label={`Requête pour ${p.name}`}
                data-testid={`requete-${q.id}`}
              />
              <Switch
                checked={q.isActive}
                onCheckedChange={(v) => modifier.mutate({ id: q.id, patch: { isActive: v } })}
                disabled={modifierEnCours.has(q.id)}
                aria-label={`Requête « ${q.query} » active`}
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
              aria-label={`Ajouter une recherche pour ${p.name}`}
              data-testid={`nouvelle-requete-${p.id}`}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!((nouvelle[p.id] ?? '').trim()) || ajouterEnCours.has(p.id)}
              onClick={() => {
                const q = (nouvelle[p.id] ?? '').trim();
                ajouter.mutate({ projectId: p.id, query: q });
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
