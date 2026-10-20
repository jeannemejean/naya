// Bandeau du projet actif, bandeau de tous les projets (avec l'alerte de surcharge) et
// « Dis à Naya où tu en es » : déplacés tels quels de l'ancien dashboard vers l'en-tête de Projets.
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { formatLocalDate } from "@/lib/dateUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Gauge, StickyNote } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Project, ProjectGoal } from "@shared/schema";
import { Link, useLocation } from "wouter";

const SUCCESS_MODE_COLORS: Record<string, string> = {
  revenue:     "bg-[rgba(212,201,122,0.18)] text-[#6f6526] border-[rgba(212,201,122,0.35)]",
  visibility:  "bg-[rgba(125,143,168,0.18)] text-[#46556d] border-[rgba(125,143,168,0.35)]",
  consistency: "bg-naya-olive-10 text-naya-olive border-naya-olive-18",
  exploration: "bg-[rgba(158,126,135,0.18)] text-[#6e4b53] border-[rgba(158,126,135,0.35)]",
  learning:    "bg-[rgba(125,143,168,0.18)] text-[#46556d] border-[rgba(125,143,168,0.35)]",
  wellbeing:   "bg-[rgba(158,126,135,0.18)] text-[#6e4b53] border-[rgba(158,126,135,0.35)]",
};

// Popover LÉGER « Dis à Naya où tu en es » accessible en 1 clic depuis chaque carte projet,
// sans naviguer vers la vue projet. Édite le seul champ statusNote (contexte non tracké par
// l'app) et sauvegarde via PATCH. L'icône est REMPLIE si une note existe déjà, VIDE sinon.
function StatusNotePopover({ projectId, initialNote }: { projectId: number; initialNote: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const seedRef = useRef(initialNote);
  seedRef.current = initialNote; // dernière valeur serveur, lue sans re-déclencher l'effet de seed
  // #3 — Re-seed du brouillon UNIQUEMENT à l'ouverture (jamais pendant que le popover est ouvert) :
  // un refetch en arrière-plan ne peut donc pas écraser la saisie en cours.
  useEffect(() => { if (open) setNote(seedRef.current); }, [open]);
  const hasNote = (initialNote || "").trim().length > 0;
  const dirty = note !== initialNote; // modifié localement mais pas encore persisté

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/projects/${projectId}`, { statusNote: note }),
    onSuccess: () => {
      toast({ title: "Enregistré", description: "Naya en tiendra compte pour ce projet." });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "full"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects?limit=200"] });
      setOpen(false); // #1 — on ne ferme QU'au succès : un PATCH échoué garde le popover ouvert, brouillon intact
    },
    onError: () => toast({ title: "Échec de l'enregistrement — ta note est conservée", variant: "destructive" }),
  });

  // Abandon : le clic-dehors / Échap (via onOpenChange={setOpen}) ET « Annuler » ferment SANS
  // sauvegarder. Le brouillon local est perdu (re-seedé depuis le serveur à la prochaine ouverture).
  // Seul le bouton « Enregistrer » déclenche le PATCH.
  const handleCancel = () => { setNote(initialNote); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={hasNote ? "Note pour Naya (remplie) — modifier" : "Dis à Naya où tu en es"}
          aria-label="Dis à Naya où tu en es"
          className={`flex-shrink-0 transition-colors ${hasNote ? "text-naya-olive hover:text-naya-olive-70" : "text-naya-olive-35 hover:text-naya-olive"}`}
        >
          <StickyNote className="h-3.5 w-3.5" fill={hasNote ? "currentColor" : "none"} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-naya-olive" />
          <h4 className="text-sm font-medium text-foreground">Dis à Naya où tu en es</h4>
          {dirty && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-[#6f6526]" title="Modifications non enregistrées">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4c97a]" />
              non enregistré
            </span>
          )}
        </div>
        <p className="text-[11px] text-naya-olive-55 leading-relaxed">
          Naya connaît déjà tout ce que tu fais <strong>dans</strong> l'app (tâches, contenus, campagnes).
          Note ici seulement ce qu'elle ne peut pas deviner : un événement externe, une décision, un blocage.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex : j'ai signé un client hors Naya ; le lancement est repoussé à octobre…"
          rows={4}
          className="text-sm resize-none"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={handleCancel} className="h-7 text-xs">Annuler</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="h-7 text-xs">
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ActiveProjectBand({ projectId, compact = false, overcommitted = false }: { projectId: number; compact?: boolean; overcommitted?: boolean }) {
  const [, navigate] = useLocation();
  const { data: project } = useQuery<Project & { goals: ProjectGoal[] }>({
    queryKey: [`/api/projects/${projectId}`],
  });

  const activeGoals = (project as any)?.goals?.filter((g: ProjectGoal) => g.status === "active") || [];
  const topGoal = activeGoals[0] as ProjectGoal | undefined;

  if (!project) return null;

  // Signal de surcharge SOBRE (jamais rouge/alerte). Traitement différencié par catégorie :
  //  · revenu  → indicateur AMBRÉ visible mais non bloquant (liseré + badge « Planning chargé »)
  //  · passion → ton plus DOUX (texte grisé « planning chargé »), pas de liseré ni d'icône
  // Catégorie non renseignée → traité comme passion (le moins présomptueux). Seuil = 1.25 uniforme.
  const isRevenue = project.category === "revenue";
  const showAmber = overcommitted && isRevenue;
  const showSoft  = overcommitted && !isRevenue;

  const daysLeft = topGoal?.dueDate
    ? Math.ceil((new Date(topGoal.dueDate as any).getTime() - Date.now()) / 86400000)
    : null;

  const progressPct = topGoal?.targetValue && topGoal?.currentValue
    ? Math.min(100, (parseFloat(topGoal.currentValue) / parseFloat(topGoal.targetValue)) * 100)
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/projects/${project.id}`); } }}
      className={`bg-card border border-naya-olive-18 rounded-lg shadow-rest cursor-pointer hover:border-naya-olive-35 transition-colors ${compact ? "p-2" : "p-4 mb-6"}`}
      style={showAmber ? { borderLeft: "3px solid rgba(212,201,122,0.75)" } : undefined}
    >
      <div className={`flex items-center justify-between ${compact ? "mb-1.5" : "mb-3"}`}>
        <div className={`flex items-center min-w-0 ${compact ? "gap-1.5" : "gap-2"}`}>
          <div
            className={`rounded-full flex-shrink-0 ${compact ? "w-1.5 h-1.5" : "w-2 h-2"}`}
            style={{ backgroundColor: project.color || "#2B2D1C" }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`font-display text-foreground truncate ${compact ? "text-[9px]" : "text-[11px]"}`}>{project.name}</span>
              {(project as any).projectKind === "client" && (
                <span
                  className="flex-shrink-0 text-[9px] font-display px-1.5 py-0.5 rounded border border-[rgba(125,143,168,0.45)] bg-[rgba(125,143,168,0.18)] text-[#354963]"
                  title="Projet client"
                >
                  💼 Client
                </span>
              )}
              {topGoal?.successMode && (
                <Badge className={`text-[9px] border ${SUCCESS_MODE_COLORS[topGoal.successMode] || "bg-naya-olive-06 text-naya-olive-55"}`}>
                  {topGoal.successMode}
                </Badge>
              )}
              {showAmber && (
                <span
                  className="flex items-center gap-1 flex-shrink-0 text-[9px] font-display px-1.5 py-0.5 rounded border border-[rgba(212,201,122,0.55)] bg-[rgba(212,201,122,0.18)] text-[#6f6526]"
                  title="Ce projet dépasse son budget de tâches du jour"
                >
                  <Gauge className="h-3 w-3" />
                  Planning chargé
                </span>
              )}
              {showSoft && (
                <span className="flex-shrink-0 text-[10px] text-naya-olive-35 italic" title="Journée bien remplie sur ce projet">
                  planning chargé
                </span>
              )}
            </div>
            {(project as any).projectKind === "client" && (project as any).clientName && (
              <span className="block text-[10px] text-naya-olive-55 truncate" title="Client">{(project as any).clientName}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {daysLeft !== null && daysLeft >= 0 && (
            <span className={`font-display text-[9px] ${
              daysLeft <= 7 ? "text-[#6f6526]" : daysLeft <= 14 ? "text-[#6e4b53]" : "text-naya-olive-55"
            }`}>
              {daysLeft}j
            </span>
          )}
          <StatusNotePopover projectId={project.id} initialNote={(project as any).statusNote ?? ""} />
        </div>
      </div>
      {topGoal ? (
        <>
          <p className={`text-foreground ${compact ? "text-[10px] leading-snug mb-1 line-clamp-1" : "text-sm mb-2"}`}>{topGoal.title}</p>
          {progressPct !== null ? (
            <div>
              <Progress value={progressPct} className="h-[2px]" />
              <p className={`text-naya-olive-55 mt-1 ${compact ? "text-[8px]" : "text-[10px]"}`}>{topGoal.currentValue} / {topGoal.targetValue}</p>
            </div>
          ) : (
            <Progress value={0} className="h-[2px] opacity-20" />
          )}
        </>
      ) : (
        <Link href="/projects" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-naya-olive-55 hover:text-foreground transition-colors cursor-pointer border-b border-naya-olive-18 hover:border-naya-olive pb-px">
            Aucun objectif actif — en ajouter un
          </span>
        </Link>
      )}
    </div>
  );
}

export function AllProjectsBand() {
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });
  const today = formatLocalDate(new Date());
  // Statut de surcharge PAR PROJET (seuil dérivé du budget/jour du projet, multiplicateur 1.25).
  const { data: overcommit = [] } = useQuery<Array<{ projectId: number; overcommitted: boolean }>>({
    queryKey: ["/api/projects/overcommit", today],
    queryFn: async () => { const r = await apiRequest("GET", `/api/projects/overcommit?clientToday=${today}`); return r.json(); },
  });
  const overcommitById = new Map(overcommit.map(o => [o.projectId, o.overcommitted]));
  const [kindFilter, setKindFilter] = useState<"all" | "client" | "personal">("all");

  const active = projects.filter(p => p.projectStatus === "active");
  if (active.length === 0) return null;

  // Le toggle n'apparaît que s'il y a au moins un projet client (sinon inutile → board plus propre).
  const hasClient = active.some(p => (p as any).projectKind === "client");
  const filtered = active.filter(p => {
    if (kindFilter === "all") return true;
    const kind = (p as any).projectKind === "client" ? "client" : "personal";
    return kind === kindFilter;
  });

  return (
    <div className="mb-6">
      {hasClient && (
        <div className="flex items-center gap-1 mb-3">
          {([["all", "Tous"], ["client", "Clients"], ["personal", "Personnels"]] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setKindFilter(val)}
              className={`text-[10px] font-display px-2.5 py-1 rounded-full border transition-colors ${
                kindFilter === val
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "bg-naya-olive-06 text-naya-olive-55 border-naya-olive-18 hover:bg-naya-olive-10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="text-xs text-naya-olive-35 italic">Aucun projet {kindFilter === "client" ? "client" : "personnel"}.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {filtered.slice(0, 4).map(p => (
            <ActiveProjectBand key={p.id} projectId={p.id} compact overcommitted={overcommitById.get(p.id) ?? false} />
          ))}
        </div>
      )}
    </div>
  );
}

// « Dis à Naya où tu en es » + réglages du projet (catégorie / budget temps / priorité).
// La note de statut sert UNIQUEMENT au contexte non tracké par l'app (Naya connaît déjà
// les tâches faites, contenus, campagnes…). Tout est injecté dans le contexte IA du projet.
export function ProjectStatusNote({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "full"],
    queryFn: async () => { const r = await apiRequest("GET", `/api/projects/${projectId}`); return r.json(); },
  });

  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [priority, setPriority] = useState("secondary");
  const [projectKind, setProjectKind] = useState<"personal" | "client">("personal");
  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [clientBrief, setClientBrief] = useState("");
  const [attributionWindow, setAttributionWindow] = useState("");

  useEffect(() => {
    if (!project) return;
    setNote(project.statusNote ?? "");
    setCategory(project.category ?? "");
    setBudget(project.dailyTimeBudgetHours != null ? String(project.dailyTimeBudgetHours) : "");
    setPriority(project.priorityLevel ?? "secondary");
    setProjectKind(project.projectKind === "client" ? "client" : "personal");
    setClientName(project.clientName ?? "");
    setClientContact(project.clientContact ?? "");
    setClientBrief(project.clientBrief ?? "");
    setAttributionWindow(project.attributionWindowDays != null ? String(project.attributionWindowDays) : "");
  }, [project?.id, project?.statusNote, project?.category, project?.dailyTimeBudgetHours, project?.priorityLevel, project?.projectKind, project?.clientName, project?.clientContact, project?.clientBrief, project?.attributionWindowDays]);

  const save = useMutation({
    mutationFn: async () => {
      const budgetNum = budget.trim() === "" ? null : Math.max(0, parseInt(budget, 10) || 0);
      const isClient = projectKind === "client";
      // Bornée 1–365 : un champ vidé ou une saisie invalide retombe sur la valeur déjà connue
      // (ou 30 par défaut) plutôt que d'envoyer null/NaN — la fenêtre n'a pas de sens à zéro.
      const fallbackWindow = project?.attributionWindowDays ?? 30;
      const parsedWindow = parseInt(attributionWindow, 10);
      const attributionWindowNum = Number.isFinite(parsedWindow)
        ? Math.min(365, Math.max(1, parsedWindow))
        : fallbackWindow;
      return apiRequest("PATCH", `/api/projects/${projectId}`, {
        statusNote: note,
        category: category || null,
        dailyTimeBudgetHours: budgetNum,
        priorityLevel: priority,
        projectKind,
        // kind='personal' → on efface les métadonnées client (null) ; kind='client' → on les persiste.
        clientName: isClient ? (clientName.trim() || null) : null,
        clientContact: isClient ? (clientContact.trim() || null) : null,
        clientBrief: isClient ? (clientBrief.trim() || null) : null,
        attributionWindowDays: attributionWindowNum,
      });
    },
    onSuccess: () => {
      toast({ title: "Enregistré", description: "Naya en tiendra compte pour ce projet." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "full"] });
    },
    onError: () => toast({ title: "Échec de l'enregistrement", variant: "destructive" }),
  });

  const fieldCls = "w-full px-2 py-1.5 text-sm rounded-lg border border-naya-olive-18 bg-white text-naya-olive-70";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-naya-olive" />
          <h3 className="text-sm font-medium text-foreground">Dis à Naya où tu en es</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-naya-olive-55">
          Tout ce que tu fais <strong>dans</strong> Naya (tâches faites, contenus, campagnes…) est déjà connu —
          inutile de le réécrire. Note ici seulement ce que l'app ne peut pas savoir : un événement externe,
          une décision, un blocage, un changement de contexte.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex : j'ai signé un nouveau client hors Naya ; le lancement est repoussé à octobre…"
          rows={4}
          className="text-sm"
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Catégorie</label>
            <select className={fieldCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              <option value="revenue">Revenu</option>
              <option value="passion">Passion</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Heures/jour</label>
            <input type="number" min={0} max={16} className={fieldCls} value={budget}
              onChange={(e) => setBudget(e.target.value)} placeholder="ex : 4" />
          </div>
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Priorité</label>
            <select className={fieldCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="primary">Principale</option>
              <option value="secondary">Secondaire</option>
              <option value="background">En fond</option>
            </select>
          </div>
        </div>
        {/* Fenêtre d'attribution — binaire (contenu dedans ou hors fenêtre), donc bornée
            1–365 j et jamais laissée vide/absurde (voir clamp dans la mutation ci-dessus). */}
        <div className="pt-1 border-t border-naya-olive-10">
          <label className="text-[11px] text-naya-olive-55 block mb-1">
            {t('projects.attributionWindowLabel')}
          </label>
          <input
            type="number"
            min={1}
            max={365}
            className={fieldCls}
            value={attributionWindow}
            onChange={(e) => setAttributionWindow(e.target.value)}
            placeholder="30"
          />
          <p className="text-[11px] text-naya-olive-55 mt-1">
            {t('projects.attributionWindowHelp')}
          </p>
        </div>
        {/* Nature du projet : perso vs client + métadonnées client conditionnelles. */}
        <div className="space-y-2 pt-1 border-t border-naya-olive-10">
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Nature du projet</label>
            <select className={fieldCls} value={projectKind} onChange={(e) => setProjectKind(e.target.value === "client" ? "client" : "personal")}>
              <option value="personal">🙂 Projet personnel</option>
              <option value="client">💼 Projet client</option>
            </select>
          </div>
          {projectKind === "client" && (
            <div className="space-y-2 rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-2.5">
              <div>
                <label className="text-[11px] text-naya-olive-55 block mb-1">Nom du client</label>
                <input className={fieldCls} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ex : Acme SARL" />
              </div>
              <div>
                <label className="text-[11px] text-naya-olive-55 block mb-1">Contact (optionnel)</label>
                <input className={fieldCls} value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="Nom · email · téléphone" />
              </div>
              <div>
                <label className="text-[11px] text-naya-olive-55 block mb-1">Brief (optionnel)</label>
                <textarea className={fieldCls} rows={2} value={clientBrief} onChange={(e) => setClientBrief(e.target.value)} placeholder="Contexte, objectifs, contraintes…" />
              </div>
            </div>
          )}
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </CardContent>
    </Card>
  );
}
