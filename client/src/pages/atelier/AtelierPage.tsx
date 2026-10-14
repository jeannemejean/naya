// L'atelier de contenu : une semaine de posts sur un seul écran (spec 2026-10-14).
// La semaine est dans l'URL (/atelier?semaine=2026-10-19) : une tâche, une notification ou le
// calendrier ouvrent exactement cet écran. Naya rédige à l'ouverture ce qui ne l'est pas encore ;
// on corrige, on ajoute les visuels, on valide — un post validé part tout seul à son heure.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, PartyPopper } from "lucide-react";
import Sidebar from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { doitRedigerAutomatiquement, plusJours } from "@shared/atelier";
import { cleAtelier, rediger, valider, type DonneesAtelier } from "./api";
import { aValider, aujourdhuiParis, postSuivant, progression, semaineDepuisRecherche } from "./navigation";
import ListePosts from "./ListePosts";
import EditeurPost from "./EditeurPost";

const EN_PARALLELE = 3;

export default function AtelierPage({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const semaine = semaineDepuisRecherche(useSearch(), aujourdhuiParis());
  const { data, isLoading, isError } = useQuery<DonneesAtelier>({ queryKey: cleAtelier(semaine) });
  const posts = data?.posts ?? [];
  const [actif, setActif] = useState<number | null>(null);
  const [enRedaction, setEnRedaction] = useState<Set<number>>(new Set());
  const [confirmeTout, setConfirmeTout] = useState(false);
  const [toutEnCours, setToutEnCours] = useState(false);
  const demandes = useRef<Set<number>>(new Set());
  const rafraichir = () => qc.invalidateQueries({ queryKey: cleAtelier(semaine) });

  // Le post ouvert : celui choisi, sinon le premier à valider, sinon le premier.
  useEffect(() => {
    if (!posts.length) return;
    if (actif == null || !posts.some((p) => p.id === actif)) setActif((posts.find(aValider) ?? posts[0]).id);
  }, [posts, actif]);
  useEffect(() => { setActif(null); setConfirmeTout(false); }, [semaine]);

  // Rédaction par Naya de ce qui ne l'est pas encore (une seule demande par post et par ouverture).
  useEffect(() => {
    const aFaire = posts.filter((p) => p.etat === "a_rediger" && doitRedigerAutomatiquement(p) && !demandes.current.has(p.id));
    if (!aFaire.length) return;
    aFaire.forEach((p) => demandes.current.add(p.id));
    let arret = false;
    const file = [...aFaire];
    const ouvrier = async () => {
      while (file.length && !arret) {
        const p = file.shift()!;
        setEnRedaction((s) => new Set(s).add(p.id));
        try { await rediger(p.id); }
        catch (e: any) {
          if (e?.message === "budget") { arret = true; toast({ title: t("atelier.erreurs.budget"), variant: "destructive" }); }
        } finally {
          setEnRedaction((s) => { const n = new Set(s); n.delete(p.id); return n; });
          void rafraichir();
        }
      }
    };
    for (let i = 0; i < EN_PARALLELE; i++) void ouvrier();
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alt + ↑ / ↓ (ou j / k hors saisie) : post précédent / suivant.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const saisie = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable=true]");
      const bas = (e.altKey && e.key === "ArrowDown") || (!saisie && e.key === "j");
      const haut = (e.altKey && e.key === "ArrowUp") || (!saisie && e.key === "k");
      if (!bas && !haut) return;
      const i = posts.findIndex((p) => p.id === actif);
      const j = bas ? Math.min(posts.length - 1, i + 1) : Math.max(0, i - 1);
      if (posts[j]) { e.preventDefault(); setActif(posts[j].id); }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [posts, actif]);

  const { faits, total } = progression(posts);
  // Seulement des brouillons : un post « à rédiger » porte encore la consigne, jamais publiée.
  const pretsATout = posts.filter((p) => p.etat === "brouillon" && p.manques.length === 0 && !enRedaction.has(p.id));
  const postActif = useMemo(() => posts.find((p) => p.id === actif) ?? null, [posts, actif]);
  const libelle = new Date(`${semaine}T12:00:00Z`).toLocaleDateString(i18n.language, { day: "numeric", month: "long" });
  const allerA = (s: string) => navigate(`/atelier?semaine=${s}`);

  const toutValider = async () => {
    if (!confirmeTout) { setConfirmeTout(true); return; }
    setConfirmeTout(false);
    setToutEnCours(true);
    let ok = 0;
    for (const p of pretsATout) {
      try { const r = await valider(p.id); if (r.statut !== "manques") ok++; } catch { /* le suivant */ }
    }
    setToutEnCours(false);
    toast({ title: t("atelier.toutValideToast", { count: ok }) });
    void rafraichir();
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-4 sm:px-6 py-4 flex-shrink-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("atelier.titre")}</h1>
              <p className="text-sm text-muted-foreground">{t("atelier.sousTitre")}</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => allerA(plusJours(semaine, -7))} aria-label={t("atelier.semainePrecedente")}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium min-w-36 text-center">{t("atelier.semaineDu", { date: libelle })}</span>
              <Button size="icon" variant="ghost" onClick={() => allerA(plusJours(semaine, 7))} aria-label={t("atelier.semaineSuivante")}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {total > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-48 space-y-1">
                <p className="text-xs text-muted-foreground">{t("atelier.progression", { faits, total })}</p>
                <Progress value={(faits / total) * 100} className="h-1.5" aria-label={t("atelier.progression", { faits, total })} />
              </div>
              {pretsATout.length > 1 && (
                <Button size="sm" variant={confirmeTout ? "default" : "outline"} disabled={toutEnCours} onClick={toutValider} onBlur={() => setConfirmeTout(false)}>
                  <CheckCheck className="w-4 h-4 mr-1.5" />
                  {confirmeTout ? t("atelier.toutValiderConfirmer", { count: pretsATout.length }) : t("atelier.toutValider", { count: pretsATout.length })}
                </Button>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isError ? (
            <p className="text-sm text-destructive">{t("atelier.erreurs.chargement")}</p>
          ) : isLoading ? (
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
              <Skeleton className="h-96 w-full" />
            </div>
          ) : total === 0 ? (
            <div className="mx-auto max-w-md text-center space-y-3 py-16">
              <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-foreground">{t("atelier.vide")}</p>
              <Link href="/content-calendar" className="text-sm text-primary hover:underline">{t("atelier.voirCalendrier")}</Link>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_1fr] max-w-6xl mx-auto">
              <aside className="space-y-3">
                {faits === total && (
                  <div className="rounded-lg bg-naya-olive-06 border border-naya-olive-18 p-3 text-sm flex gap-2">
                    <PartyPopper className="w-4 h-4 text-naya-salvia flex-shrink-0 mt-0.5" />
                    <span>{t("atelier.semainePrete")}</span>
                  </div>
                )}
                <ListePosts posts={posts} actif={actif} enRedaction={enRedaction} onChoisir={setActif} />
                <p className="text-[11px] text-muted-foreground hidden lg:block">{t("atelier.raccourcisNavigation")}</p>
              </aside>
              {postActif && (
                <EditeurPost
                  key={postActif.id}
                  post={postActif}
                  enRedaction={enRedaction.has(postActif.id)}
                  onChange={() => { void rafraichir(); }}
                  onValide={() => { const s = postSuivant(posts, postActif.id); if (s != null) setActif(s); }}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
