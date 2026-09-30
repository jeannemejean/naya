import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetchJson';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useEnsembleId } from '@/hooks/use-ensemble-id';
import { RequetesDeVeille } from '@/components/reading/requetes-de-veille';
import type { ReadingCard } from '@shared/schema';

interface Projet { id: number; name: string }

// La revue du matin. Zéro à trois fiches. Aucun compteur, aucune série, aucune relance :
// une fiche non traitée disparaît le soir et personne n'en reparle.
export function RevueDuMatin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reponses, setReponses] = useState<Record<number, string>>({});

  const [repondreEnCours, marquerRepondreEnCours, retirerRepondreEnCours] = useEnsembleId();
  const [garderEnCours, marquerGarderEnCours, retirerGarderEnCours] = useEnsembleId();
  const [passerEnCours, marquerPasserEnCours, retirerPasserEnCours] = useEnsembleId();

  // Garde-fou du double brouillon (traité côté interface, pas par migration) : rien en
  // base ne relie un contenu créé à sa fiche d'origine, donc un deuxième clic créerait
  // un deuxième brouillon identique. Ces deux ensembles vivent uniquement dans ce
  // composant — un aller-retour serveur ne les efface pas, un rechargement de page si.
  const [envoiEnCours, marquerEnvoiEnCours, retirerEnvoiEnCours] = useEnsembleId();
  const [brouillonsCrees, marquerBrouillonCree] = useEnsembleId();

  const { data, isLoading } = useQuery<{ cards: ReadingCard[] }>({
    queryKey: ['/api/reading/today'],
    queryFn: () => fetchJson('/api/reading/today'),
  });
  const { data: projets } = useQuery<Projet[]>({
    queryKey: ['/api/projects'],
    queryFn: () => fetchJson('/api/projects'),
  });

  const invalider = () => qc.invalidateQueries({ queryKey: ['/api/reading/today'] });

  // Message d'échec sobre : factuel, sans excuse ni dramatisation, mais explicite sur ce
  // qui n'a pas eu lieu — un avis perdu est la seule perte de contenu réelle de cet écran.
  const signalerEchec = (description: string) =>
    toast({ title: 'Non enregistré', description, variant: 'destructive' });

  const repondre = useMutation({
    mutationFn: ({ id, answer }: { id: number; answer: string }) =>
      fetchJson(`/api/reading/cards/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      }),
    onMutate: ({ id }) => marquerRepondreEnCours(id),
    onSuccess: invalider,
    onError: () => signalerEchec('Ta réponse n’est pas enregistrée : réessaie avant de changer d’écran.'),
    onSettled: (_data, _erreur, { id }) => retirerRepondreEnCours(id),
  });

  const garder = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/reading/cards/${id}/keep`, { method: 'POST' }),
    onMutate: (id) => marquerGarderEnCours(id),
    onSuccess: invalider,
    onError: () => signalerEchec('« Garder » n’a pas abouti : réessaie.'),
    onSettled: (_data, _erreur, id) => retirerGarderEnCours(id),
  });

  const passer = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/reading/cards/${id}/skip`, { method: 'POST' }),
    onMutate: (id) => marquerPasserEnCours(id),
    onSuccess: invalider,
    onError: () => signalerEchec('« Passer » n’a pas abouti : réessaie.'),
    onSettled: (_data, _erreur, id) => retirerPasserEnCours(id),
  });

  const enFaireUnPost = useMutation({
    mutationFn: (id: number) => fetchJson<{ contentId: number }>(`/api/reading/cards/${id}/to-content`, { method: 'POST' }),
    onMutate: (id: number) => marquerEnvoiEnCours(id),
    onSuccess: (_data, id) => {
      marquerBrouillonCree(id);
      toast({ title: 'Brouillon créé', description: 'Il t’attend dans le calendrier éditorial.' });
    },
    onError: () => signalerEchec('Le brouillon n’a pas été créé : réessaie.'),
    onSettled: (_data, _erreur, id) => retirerEnvoiEnCours(id),
  });

  if (isLoading) return null;

  const cards = data?.cards ?? [];
  const nomProjet = (id: number) => projets?.find((p) => p.id === id)?.name ?? '';

  // Matin vide : une phrase, et rien d'autre. Pas d'excuse, pas de bouton pour en chercher plus.
  if (cards.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Ce matin</h2>
        <p className="text-sm text-muted-foreground">Rien qui mérite ton avis ce matin.</p>
        <div className="mt-3">
          <RequetesDeVeille />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Ce matin</h2>
      <div className="space-y-4">
        {cards.map((c) => (
          <Card key={c.id} data-testid={`reading-card-${c.id}`}>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Badge variant="outline" className="text-[10px]">{nomProjet(c.projectId)}</Badge>
                  <a href={c.url} target="_blank" rel="noreferrer" className="block font-medium leading-tight hover:underline">
                    {c.title}
                  </a>
                  {c.source && <p className="text-xs text-muted-foreground">{c.source}</p>}
                </div>
              </div>

              <p className="text-sm">{c.factSummary}</p>
              <p className="text-sm text-muted-foreground">{c.whyThisBrand}</p>
              <p className="text-sm"><span className="text-muted-foreground">Angle : </span>{c.angle}</p>

              <p className="text-base font-medium pt-1">{c.question}</p>

              {c.userAnswer ? (
                <div className="space-y-3">
                  <p className="text-sm whitespace-pre-wrap rounded-md bg-muted p-3">{c.userAnswer}</p>
                  {/* Le brouillon n'existe qu'APRÈS la réponse, et il part de sa réponse.
                      Après succès, le bouton disparaît : un deuxième clic est impossible. */}
                  {brouillonsCrees.has(c.id) ? (
                    <p className="text-xs text-muted-foreground" data-testid={`reading-post-cree-${c.id}`}>
                      Brouillon créé, il t’attend dans le calendrier éditorial.
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => enFaireUnPost.mutate(c.id)}
                      disabled={envoiEnCours.has(c.id)}
                      data-testid={`reading-en-faire-un-post-${c.id}`}
                    >
                      En faire un post
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={reponses[c.id] ?? ''}
                    onChange={(e) => setReponses((r) => ({ ...r, [c.id]: e.target.value }))}
                    placeholder="Ton avis…"
                    aria-label="Ton avis"
                    rows={3}
                    data-testid={`reading-answer-${c.id}`}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!((reponses[c.id] ?? '').trim()) || repondreEnCours.has(c.id)}
                      onClick={() => repondre.mutate({ id: c.id, answer: (reponses[c.id] ?? '').trim() })}
                    >
                      Répondre
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={garderEnCours.has(c.id)}
                      onClick={() => garder.mutate(c.id)}
                    >
                      Garder
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={passerEnCours.has(c.id)}
                      onClick={() => passer.mutate(c.id)}
                    >
                      Passer
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-4">
        <RequetesDeVeille />
      </div>
    </section>
  );
}
