import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sun, Moon, LogOut, RefreshCw, AlertTriangle, User, Zap, Brain, Clock, Calendar, Sparkles, Loader2, CheckCircle2, Link2Off, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import type { UserOperatingProfile, UserPreferences, BrandDna } from "@shared/schema";

// ─── Chip Keyword Input ──────────────────────────────────────────────────────
function KeywordChipInput({
  values,
  onChange,
  max,
  placeholder,
}: {
  values: string[];
  onChange: (vals: string[]) => void;
  max: number;
  placeholder?: string;
}) {
  const [inputVal, setInputVal] = useState('');

  function addKeyword(raw: string) {
    const kw = raw.trim();
    if (!kw || values.includes(kw) || values.length >= max) return;
    onChange([...values, kw]);
    setInputVal('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addKeyword(inputVal);
    } else if (e.key === 'Backspace' && !inputVal && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 border border-slate-200 dark:border-gray-600 rounded-lg px-2.5 py-2 bg-white dark:bg-gray-800 min-h-[44px] focus-within:ring-1 focus-within:ring-primary/30 focus-within:border-primary/50 transition-colors">
      {values.map(kw => (
        <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
          {kw}
          <button type="button" onClick={() => onChange(values.filter(v => v !== kw))} className="hover:text-red-400 transition-colors leading-none">×</button>
        </span>
      ))}
      {values.length < max && (
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputVal.trim() && addKeyword(inputVal)}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] text-sm bg-transparent outline-none text-slate-700 dark:text-gray-200 placeholder:text-slate-400 dark:placeholder:text-gray-500"
        />
      )}
    </div>
  );
}

interface SettingsProps {
  onSearchClick?: () => void;
}

const AVOIDANCE_OPTIONS = [
  { value: "visibility", label: "Showing or sharing my work" },
  { value: "selling", label: "Selling or promoting myself" },
  { value: "starting", label: "Starting something new" },
  { value: "admin-tasks", label: "Admin and paperwork" },
  { value: "perfectionism", label: "Finishing when it feels imperfect" },
  { value: "repetitive", label: "Repetitive or routine tasks" },
  { value: "asking-for-help", label: "Asking for help or feedback" },
];

// ─── Structured Content Pillar Editor ────────────────────────────────────────
interface ContentPillar {
  name: string;
  description: string;
  formats: string[];
  frequency: string;
}

const CONTENT_FORMAT_OPTIONS = [
  'Long-form post', 'Short post', 'Carousel / slides', 'Newsletter article',
  'Video / Reel', 'Story / Ephemeral', 'Case study', 'Thread', 'Podcast episode', 'Infographic',
];

function PillarListEditor({
  pillars,
  onChange,
}: {
  pillars: ContentPillar[];
  onChange: (p: ContentPillar[]) => void;
}) {
  const empty: ContentPillar = { name: '', description: '', formats: [], frequency: '' };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ContentPillar>(empty);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  function saveDraft() {
    if (!draft.name.trim()) return;
    if (editIdx !== null) {
      const next = pillars.map((p, i) => i === editIdx ? draft : p);
      onChange(next);
      setEditIdx(null);
    } else {
      onChange([...pillars, draft]);
    }
    setDraft(empty);
    setAdding(false);
  }

  function startEdit(i: number) {
    setDraft({ ...pillars[i] });
    setEditIdx(i);
    setAdding(true);
  }

  function removePillar(i: number) {
    onChange(pillars.filter((_, j) => j !== i));
  }

  function toggleFormat(f: string) {
    setDraft(d => ({
      ...d,
      formats: d.formats.includes(f) ? d.formats.filter(x => x !== f) : [...d.formats, f],
    }));
  }

  return (
    <div className="space-y-2">
      {pillars.map((p, i) => (
        <div key={i} className="border border-slate-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800/60">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800 dark:text-white truncate">{p.name}</p>
              {p.description && <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-2">{p.description}</p>}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {p.formats.map(f => (
                  <span key={f} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{f}</span>
                ))}
                {p.frequency && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400">{p.frequency}</span>}
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => startEdit(i)} className="text-[10px] text-slate-400 hover:text-primary transition-colors px-1">Edit</button>
              <button onClick={() => removePillar(i)} className="text-[10px] text-slate-400 hover:text-red-400 transition-colors px-1">Remove</button>
            </div>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="border border-primary/30 rounded-xl p-3 bg-primary/5 dark:bg-primary/10 space-y-2.5">
          <div className="space-y-1">
            <Label className="text-xs">Pillar name *</Label>
            <input
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Founder mindset"
              className="w-full text-sm border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What you explore in this pillar</Label>
            <textarea
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder="What topics, angles, and stories you cover here…"
              rows={2}
              className="w-full text-sm border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Formats you use for this pillar</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_FORMAT_OPTIONS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFormat(f)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    draft.formats.includes(f)
                      ? 'bg-primary text-white border-primary'
                      : 'border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:border-primary/50'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Publishing frequency</Label>
            <select
              value={draft.frequency}
              onChange={e => setDraft(d => ({ ...d, frequency: e.target.value }))}
              className="w-full text-sm border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Choose frequency…</option>
              <option value="daily">Daily</option>
              <option value="2-3 per week">2–3× per week</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="as needed">As needed / ad hoc</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={saveDraft} disabled={!draft.name.trim()} className="text-xs h-7">{editIdx !== null ? 'Update pillar' : 'Add pillar'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(empty); setEditIdx(null); }} className="text-xs h-7">Cancel</Button>
          </div>
        </div>
      ) : pillars.length < 5 ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="text-xs w-full">+ Add content pillar</Button>
      ) : (
        <p className="text-[11px] text-slate-400 dark:text-gray-500 text-center py-1">Maximum 5 pillars reached</p>
      )}
    </div>
  );
}

// ─── Structured Milestone Editor ──────────────────────────────────────────────
interface Milestone {
  title: string;
  targetDate: string;
  status: 'pending' | 'in-progress' | 'done';
}

const STATUS_LABELS: Record<Milestone['status'], { label: string; cls: string }> = {
  pending:     { label: 'Pending',     cls: 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-gray-400' },
  'in-progress': { label: 'In progress', cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  done:        { label: 'Done',        cls: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
};

function MilestoneListEditor({
  milestones,
  onChange,
}: {
  milestones: Milestone[];
  onChange: (m: Milestone[]) => void;
}) {
  const empty: Milestone = { title: '', targetDate: '', status: 'pending' };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Milestone>(empty);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  function saveDraft() {
    if (!draft.title.trim()) return;
    if (editIdx !== null) {
      onChange(milestones.map((m, i) => i === editIdx ? draft : m));
      setEditIdx(null);
    } else {
      onChange([...milestones, draft]);
    }
    setDraft(empty);
    setAdding(false);
  }

  function startEdit(i: number) {
    setDraft({ ...milestones[i] });
    setEditIdx(i);
    setAdding(true);
  }

  function cycleStatus(i: number) {
    const order: Milestone['status'][] = ['pending', 'in-progress', 'done'];
    const next = order[(order.indexOf(milestones[i].status) + 1) % order.length];
    onChange(milestones.map((m, j) => j === i ? { ...m, status: next } : m));
  }

  return (
    <div className="space-y-2">
      {milestones.map((m, i) => {
        const st = STATUS_LABELS[m.status];
        return (
          <div key={i} className="border border-slate-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800/60">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 dark:text-white">{m.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  {m.targetDate && <span className="text-[10px] text-slate-400 dark:text-gray-500">📅 {m.targetDate}</span>}
                  <button onClick={() => cycleStatus(i)} className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls} hover:opacity-80 transition-opacity`}>
                    {st.label}
                  </button>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => startEdit(i)} className="text-[10px] text-slate-400 hover:text-primary transition-colors px-1">Edit</button>
                <button onClick={() => onChange(milestones.filter((_, j) => j !== i))} className="text-[10px] text-slate-400 hover:text-red-400 transition-colors px-1">Remove</button>
              </div>
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="border border-primary/30 rounded-xl p-3 bg-primary/5 dark:bg-primary/10 space-y-2.5">
          <div className="space-y-1">
            <Label className="text-xs">Milestone *</Label>
            <input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="e.g. Launch beta, Hit 1000 subscribers, Sign first retainer…"
              className="w-full text-sm border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Target date (optional)</Label>
            <input
              value={draft.targetDate}
              onChange={e => setDraft(d => ({ ...d, targetDate: e.target.value }))}
              placeholder="e.g. April 2026, Q2 2026, by end of year…"
              className="w-full text-sm border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <select
              value={draft.status}
              onChange={e => setDraft(d => ({ ...d, status: e.target.value as Milestone['status'] }))}
              className="w-full text-sm border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="pending">Pending</option>
              <option value="in-progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={saveDraft} disabled={!draft.title.trim()} className="text-xs h-7">{editIdx !== null ? 'Update milestone' : 'Add milestone'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(empty); setEditIdx(null); }} className="text-xs h-7">Cancel</Button>
          </div>
        </div>
      ) : milestones.length < 5 ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="text-xs w-full">+ Add milestone</Button>
      ) : (
        <p className="text-[11px] text-slate-400 dark:text-gray-500 text-center py-1">Maximum 5 milestones reached</p>
      )}
    </div>
  );
}

function GoogleCalendarCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status } = useQuery<{ connected: boolean }>({
    queryKey: ['/api/calendar/status'],
    retry: false,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('GET', '/api/calendar/oauth/url');
      const { url } = await res.json();
      window.location.href = url;
    },
    onError: () => toast({ title: 'Erreur', description: 'Impossible de contacter Google.', variant: 'destructive' }),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/calendar/disconnect'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/status'] });
      toast({ title: 'Calendrier déconnecté', description: 'Les événements Google ne seront plus affichés.' });
    },
    onError: () => toast({ title: 'Erreur', description: 'Déconnexion échouée.', variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4 text-blue-500" />
          Google Calendar
        </CardTitle>
        <CardDescription>
          Affiche tes rendez-vous dans le planning et bloque les créneaux pendant les réunions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status?.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Connecté — événements synchronisés
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800"
            >
              {disconnectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Déconnecter'}
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="w-full gap-2"
          >
            {connectMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calendar className="h-4 w-4" />
            )}
            Connecter Google Calendar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Social Connections Card ─────────────────────────────────────────────────

const SOCIAL_PLATFORMS = [
  {
    id: 'instagram' as const,
    name: 'Instagram',
    description: 'Publie des posts et Reels directement depuis Naya.',
    gradient: 'from-purple-500 via-pink-500 to-orange-400',
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
  },
  {
    id: 'linkedin' as const,
    name: 'LinkedIn',
    description: 'Partage tes posts et articles professionnels.',
    gradient: 'from-blue-600 to-blue-700',
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
  {
    id: 'twitter' as const,
    name: 'X / Twitter',
    description: 'Publie des tweets et threads directement.',
    gradient: 'from-slate-800 to-slate-900',
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
];

function SocialConnectionsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();

  const { data: status = {} } = useQuery<Record<string, {
    connected: boolean;
    accountName?: string;
    expiresAt?: string;
    configured: boolean;
  }>>({
    queryKey: ['/api/social/status'],
    retry: false,
  });

  // Notifications after OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const social = params.get('social');
    const st = params.get('status');
    const reason = params.get('reason');
    if (social && st) {
      if (st === 'connected') {
        toast({ title: `${social.charAt(0).toUpperCase() + social.slice(1)} connecté`, description: 'Naya peut maintenant publier sur ce réseau.' });
        queryClient.invalidateQueries({ queryKey: ['/api/social/status'] });
      } else if (st === 'error') {
        toast({ title: 'Connexion échouée', description: reason || 'Réessaie.', variant: 'destructive' });
      }
      // Nettoyer les query params sans recharger
      const url = new URL(window.location.href);
      url.searchParams.delete('social');
      url.searchParams.delete('status');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const connectMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await fetch(`/api/social/oauth/${platform}/url`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur');
      if (data.notConfigured) throw new Error(data.message);
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({ title: 'Connexion impossible', description: err.message, variant: 'destructive' });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await fetch(`/api/social/disconnect/${platform}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Déconnexion échouée');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/status'] });
      toast({ title: 'Réseau déconnecté' });
    },
    onError: () => toast({ title: 'Erreur', description: 'Déconnexion échouée.', variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2Off className="h-4 w-4 text-primary" />
          Réseaux sociaux
        </CardTitle>
        <CardDescription>
          Connecte tes comptes pour que Naya puisse analyser tes performances et publier du contenu automatiquement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {SOCIAL_PLATFORMS.map(({ id, name, description, gradient, Icon }) => {
          const info = status[id];
          const isConnected = !!info?.connected;
          const isConfigured = info?.configured !== false;
          const isPending = connectMutation.isPending || disconnectMutation.isPending;

          return (
            <div
              key={id}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card"
            >
              {/* Logo */}
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white flex-shrink-0`}>
                <Icon />
              </div>

              {/* Infos */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{name}</p>
                {isConnected ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                    <CheckCircle2 className="h-3 w-3" />
                    {info?.accountName || 'Connecté'}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                )}
                {!isConfigured && (
                  <p className="text-xs text-amber-500 mt-0.5">Variables d'env manquantes</p>
                )}
              </div>

              {/* Action */}
              {isConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 flex-shrink-0"
                  onClick={() => disconnectMutation.mutate(id)}
                  disabled={isPending}
                >
                  {disconnectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Déconnecter'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="flex-shrink-0 gap-1.5"
                  onClick={() => connectMutation.mutate(id)}
                  disabled={isPending}
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3 w-3" />
                  )}
                  Connecter
                </Button>
              )}
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground pt-1">
          Naya utilise OAuth officiel — tes identifiants ne sont jamais stockés en clair.
        </p>
      </CardContent>
    </Card>
  );
}

export default function Settings({ onSearchClick }: SettingsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);

  const ALL_DAYS = [
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
    { key: 'sun', label: 'Sun' },
  ];

  const TIME_OPTIONS = Array.from({ length: 25 }, (_, i) => {
    const h = Math.floor(i / 2) + 7;
    const m = (i % 2) * 30;
    if (h > 19) return null;
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return val;
  }).filter(Boolean) as string[];

  const { data: schedulePrefs } = useQuery<UserPreferences>({
    queryKey: ['/api/preferences'],
  });

  const [workDays, setWorkDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [lunchEnabled, setLunchEnabled] = useState(true);
  const [lunchStart, setLunchStart] = useState('12:00');
  const [lunchEnd, setLunchEnd] = useState('13:00');
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [planningStartDate, setPlanningStartDate] = useState('');
  useEffect(() => {
    if (schedulePrefs) {
      setWorkDays((schedulePrefs.workDays || 'mon,tue,wed,thu,fri').split(',').filter(Boolean));
      setLunchEnabled(schedulePrefs.lunchBreakEnabled ?? true);
      setLunchStart(schedulePrefs.lunchBreakStart || '12:00');
      setLunchEnd(schedulePrefs.lunchBreakEnd || '13:00');
      setWorkStart(schedulePrefs.workDayStart || '09:00');
      setWorkEnd(schedulePrefs.workDayEnd || '18:00');
      setPlanningStartDate((schedulePrefs as any).planningStartDate || '');
    }
  }, [schedulePrefs]);

  const updateScheduleMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest('PATCH', '/api/preferences', data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
      toast({ title: t('settings.saved') });
    },
    onError: () => toast({ title: t('common.error'), description: t('settings.failedToSave'), variant: "destructive" }),
  });

  const handleSaveSchedule = () => {
    if (workDays.length === 0) {
      toast({ title: "Select at least one work day", variant: "destructive" });
      return;
    }
    updateScheduleMutation.mutate({
      workDays: workDays.join(','),
      lunchBreakEnabled: lunchEnabled,
      lunchBreakStart: lunchStart,
      lunchBreakEnd: lunchEnd,
      workDayStart: workStart,
      workDayEnd: workEnd,
      planningStartDate: planningStartDate || null,
    });
  };

  const toggleDay = (day: string) => {
    setWorkDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const { data: operatingProfile } = useQuery<UserOperatingProfile | null>({
    queryKey: ['/api/me/operating-profile'],
  });

  const [profileDraft, setProfileDraft] = useState<Partial<UserOperatingProfile>>({});

  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<UserOperatingProfile>) =>
      apiRequest('PATCH', '/api/me/operating-profile', data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/me/operating-profile'] });
      setProfileEditOpen(false);
      toast({ title: t('settings.saved') });
    },
  });

  const resetOnboardingMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/me/onboarding-reset'),
    onSuccess: () => {
      toast({ title: t('settings.dataReset') });
      localStorage.removeItem('naya_active_project_id');
      setTimeout(() => { window.location.href = "/"; }, 1500);
    },
    onError: () => toast({ title: t('common.error'), description: t('settings.failedToSave'), variant: "destructive" }),
  });

  // ─── Brand DNA ───────────────────────────────────────────────────────────
  const { data: brandDna, isLoading: brandDnaLoading } = useQuery<BrandDna | null>({
    queryKey: ['/api/brand-dna'],
  });

  // Identity tab
  const [dnaBusinessName, setDnaBusinessName] = useState('');
  const [dnaWebsite, setDnaWebsite] = useState('');
  const [dnaLinkedin, setDnaLinkedin] = useState('');
  const [dnaInstagram, setDnaInstagram] = useState('');
  const [dnaBusinessType, setDnaBusinessType] = useState('');
  const [dnaBusinessModel, setDnaBusinessModel] = useState('');
  const [dnaTargetAudience, setDnaTargetAudience] = useState('');
  const [dnaUniquePositioning, setDnaUniquePositioning] = useState('');
  const [dnaCorePainPoint, setDnaCorePainPoint] = useState('');
  const [dnaAudienceAspiration, setDnaAudienceAspiration] = useState('');
  const [dnaAuthorityLevel, setDnaAuthorityLevel] = useState('');

  // Offers & Market tab
  const [dnaOffers, setDnaOffers] = useState('');
  const [dnaPriceRange, setDnaPriceRange] = useState('');
  const [dnaClientJourney, setDnaClientJourney] = useState('');
  const [dnaCompetitorLandscape, setDnaCompetitorLandscape] = useState('');

  // Content & Platforms tab
  const [dnaVoiceKw, setDnaVoiceKw] = useState<string[]>([]);
  const [dnaAntiKw, setDnaAntiKw] = useState<string[]>([]);
  const [dnaEditorialTerritory, setDnaEditorialTerritory] = useState('');
  const [dnaPlatformPriority, setDnaPlatformPriority] = useState('');
  const [dnaCommunicationStyle, setDnaCommunicationStyle] = useState('');
  const [dnaCurrentPresence, setDnaCurrentPresence] = useState('');
  const [dnaContentBandwidth, setDnaContentBandwidth] = useState('');
  const [dnaVisualIdentityNotes, setDnaVisualIdentityNotes] = useState('');
  const [dnaReferenceBrands, setDnaReferenceBrands] = useState<string[]>([]);
  const [dnaContentPillarsDetailed, setDnaContentPillarsDetailed] = useState<ContentPillar[]>([]);

  // Active Priorities tab
  const [dnaActiveBusinessPriority, setDnaActiveBusinessPriority] = useState('');
  const [dnaCurrentBusinessStage, setDnaCurrentBusinessStage] = useState('');
  const [dnaRevenueTarget, setDnaRevenueTarget] = useState('');
  const [dnaRevenueUrgency, setDnaRevenueUrgency] = useState('');
  const [dnaPrimaryGoal, setDnaPrimaryGoal] = useState('');
  const [dnaSuccessDefinition, setDnaSuccessDefinition] = useState('');
  const [dnaCurrentChallenges, setDnaCurrentChallenges] = useState('');
  const [dnaTeamStructure, setDnaTeamStructure] = useState('');
  const [dnaOperationalConstraints, setDnaOperationalConstraints] = useState('');
  const [dnaGeographicFocus, setDnaGeographicFocus] = useState('');
  const [dnaLanguageStrategy, setDnaLanguageStrategy] = useState('');
  const [dnaKeyMilestones, setDnaKeyMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    if (!brandDna) return;
    setDnaBusinessName(brandDna.businessName || '');
    setDnaWebsite(brandDna.website || '');
    setDnaLinkedin(brandDna.linkedinProfile || '');
    setDnaInstagram(brandDna.instagramHandle || '');
    setDnaBusinessType(brandDna.businessType || '');
    setDnaBusinessModel(brandDna.businessModel || '');
    setDnaTargetAudience(brandDna.targetAudience || '');
    setDnaUniquePositioning(brandDna.uniquePositioning || '');
    setDnaCorePainPoint(brandDna.corePainPoint || '');
    setDnaAudienceAspiration(brandDna.audienceAspiration || '');
    setDnaAuthorityLevel(brandDna.authorityLevel || '');
    setDnaOffers(brandDna.offers || '');
    setDnaPriceRange(brandDna.priceRange || '');
    setDnaClientJourney(brandDna.clientJourney || '');
    setDnaCompetitorLandscape(brandDna.competitorLandscape || '');
    setDnaVoiceKw(brandDna.brandVoiceKeywords || []);
    setDnaAntiKw(brandDna.brandVoiceAntiKeywords || []);
    setDnaEditorialTerritory(brandDna.editorialTerritory || '');
    setDnaPlatformPriority(brandDna.platformPriority || '');
    setDnaCommunicationStyle(brandDna.communicationStyle || '');
    setDnaCurrentPresence(brandDna.currentPresence || '');
    setDnaContentBandwidth(brandDna.contentBandwidth || '');
    setDnaVisualIdentityNotes(brandDna.visualIdentityNotes || '');
    setDnaReferenceBrands(brandDna.referenceBrands || []);
    // contentPillarsDetailed: jsonb — stored as ContentPillar[] objects
    const pillarsRaw = brandDna.contentPillarsDetailed;
    if (Array.isArray(pillarsRaw)) {
      setDnaContentPillarsDetailed(pillarsRaw.map((p: any) =>
        typeof p === 'string'
          ? { name: p, description: '', formats: [], frequency: '' }
          : { name: p?.name || '', description: p?.description || '', formats: Array.isArray(p?.formats) ? p.formats : [], frequency: p?.frequency || '' }
      ));
    } else {
      setDnaContentPillarsDetailed([]);
    }
    setDnaActiveBusinessPriority(brandDna.activeBusinessPriority || '');
    setDnaCurrentBusinessStage(brandDna.currentBusinessStage || '');
    setDnaRevenueTarget(brandDna.revenueTarget || '');
    setDnaRevenueUrgency(brandDna.revenueUrgency || '');
    setDnaPrimaryGoal(brandDna.primaryGoal || '');
    setDnaSuccessDefinition(brandDna.successDefinition || '');
    setDnaCurrentChallenges(brandDna.currentChallenges || '');
    setDnaTeamStructure(brandDna.teamStructure || '');
    setDnaOperationalConstraints(brandDna.operationalConstraints || '');
    setDnaGeographicFocus(brandDna.geographicFocus || '');
    setDnaLanguageStrategy(brandDna.languageStrategy || '');
    // keyMilestones: jsonb — stored as Milestone[] objects
    const milestonesRaw = brandDna.keyMilestones;
    if (Array.isArray(milestonesRaw)) {
      setDnaKeyMilestones(milestonesRaw.map((m: any) =>
        typeof m === 'string'
          ? { title: m, targetDate: '', status: 'pending' as const }
          : { title: m?.title || '', targetDate: m?.targetDate || '', status: (m?.status as Milestone['status']) || 'pending' }
      ));
    } else {
      setDnaKeyMilestones([]);
    }
  }, [brandDna]);

  // Show toast if redirected back from Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cal = params.get('calendar');
    if (cal === 'connected') {
      toast({ title: 'Google Calendar connecté', description: 'Tes événements apparaîtront maintenant dans le planning.' });
      window.history.replaceState({}, '', '/settings');
    } else if (cal === 'error') {
      toast({ title: 'Connexion échouée', description: 'Réessaie depuis les paramètres.', variant: 'destructive' });
      window.history.replaceState({}, '', '/settings');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patchBrandDna = useMutation({
    mutationFn: (data: Partial<BrandDna>) => apiRequest('PATCH', '/api/brand-dna', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/brand-dna'] });
      toast({ title: t('settings.saved') });
    },
    onError: () => toast({ title: t('common.error'), description: t('settings.failedToSave'), variant: "destructive" }),
  });

  const refreshIntelligence = useMutation({
    mutationFn: () => apiRequest('POST', '/api/brand-dna/refresh-intelligence'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/brand-dna'] });
      toast({ title: t('settings.saved') });
    },
    onError: () => toast({ title: t('common.error'), description: t('settings.failedToSave'), variant: "destructive" }),
  });

  const handleOpenProfileEdit = () => {
    setProfileDraft({
      planningStyle: operatingProfile?.planningStyle || undefined,
      motivationStyle: operatingProfile?.motivationStyle || undefined,
      energyRhythm: operatingProfile?.energyRhythm || undefined,
      workBlockPreference: operatingProfile?.workBlockPreference || undefined,
      activationStyle: operatingProfile?.activationStyle || undefined,
      encouragementStyle: operatingProfile?.encouragementStyle || undefined,
      avoidanceTriggers: operatingProfile?.avoidanceTriggers || [],
      selfDescribedFriction: operatingProfile?.selfDescribedFriction || '',
    });
    setProfileEditOpen(true);
  };

  const handleAvoidanceTriggerToggle = (value: string) => {
    const current = profileDraft.avoidanceTriggers || [];
    setProfileDraft(prev => ({
      ...prev,
      avoidanceTriggers: current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value],
    }));
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <h1 className="text-xl font-bold tracking-tight text-foreground">{t('settings.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('settings.subtitle')}</p>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">

            {/* Account */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="h-4 w-4" /> {t('settings.profile')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center">
                    <span className="text-white">
                      {user?.firstName?.charAt(0) || user?.email?.charAt(0) || "U"}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.firstName || user?.email || "User"}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-gray-400">{user?.email}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Appearance */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {t('settings.theme')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-900 dark:text-white">{t('settings.dark')}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      {theme === 'light' ? t('settings.light') : t('settings.dark')}
                    </p>
                  </div>
                  <Switch
                    checked={theme === 'dark'}
                    onCheckedChange={toggleTheme}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Schedule */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-4 w-4" /> {t('settings.preferences')}
                </CardTitle>
                <CardDescription>{t('settings.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Date de démarrage de la planification */}
                <div className="space-y-2">
                  <Label className="text-sm">Date de démarrage de la planification</Label>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Naya ne génère aucune tâche et ne déplace rien avant cette date. Laisse vide pour démarrer immédiatement.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={planningStartDate}
                      onChange={e => setPlanningStartDate(e.target.value)}
                      className="text-sm px-3 py-1.5 rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200"
                    />
                    {planningStartDate && (
                      <button
                        onClick={() => setPlanningStartDate('')}
                        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 underline"
                      >
                        Effacer (démarrer maintenant)
                      </button>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label className="text-sm">Working days</Label>
                  <div className="flex gap-1.5">
                    {ALL_DAYS.map(d => (
                      <button
                        key={d.key}
                        onClick={() => toggleDay(d.key)}
                        className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                          workDays.includes(d.key)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label className="text-sm flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" /> Working hours
                  </Label>
                  <div className="flex items-center gap-3">
                    <Select value={workStart} onValueChange={setWorkStart}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-slate-500 dark:text-gray-400">to</span>
                    <Select value={workEnd} onValueChange={setWorkEnd}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Lunch break</Label>
                    <Switch checked={lunchEnabled} onCheckedChange={setLunchEnabled} />
                  </div>
                  {lunchEnabled && (
                    <div className="flex items-center gap-3">
                      <Select value={lunchStart} onValueChange={setLunchStart}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-slate-500 dark:text-gray-400">to</span>
                      <Select value={lunchEnd} onValueChange={setLunchEnd}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleSaveSchedule}
                  disabled={updateScheduleMutation.isPending}
                  className="w-full"
                >
                  {updateScheduleMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </CardContent>
            </Card>

            {/* How You Work */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Brain className="h-4 w-4" /> {t('settings.operatingProfile')}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Your operating profile shapes how Naya frames tasks and generates prompts
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleOpenProfileEdit}>
                    {t('common.edit')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {operatingProfile ? (
                  <div className="space-y-2">
                    {operatingProfile.energyRhythm && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500 dark:text-gray-400 w-36">{t('settings.energyRhythm')}</span>
                        <Badge variant="outline" className="text-xs">{operatingProfile.energyRhythm.replace(/-/g, ' ')}</Badge>
                      </div>
                    )}
                    {operatingProfile.planningStyle && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500 dark:text-gray-400 w-36">{t('settings.planningStyle')}</span>
                        <Badge variant="outline" className="text-xs">{operatingProfile.planningStyle}</Badge>
                      </div>
                    )}
                    {operatingProfile.activationStyle && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500 dark:text-gray-400 w-36">{t('settings.activationStyle')}</span>
                        <Badge variant="outline" className="text-xs">{operatingProfile.activationStyle.replace(/-/g, ' ')}</Badge>
                      </div>
                    )}
                    {operatingProfile.avoidanceTriggers && operatingProfile.avoidanceTriggers.length > 0 && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="text-slate-500 dark:text-gray-400 w-36 mt-0.5">{t('settings.avoidanceTriggers')}</span>
                        <div className="flex flex-wrap gap-1">
                          {operatingProfile.avoidanceTriggers.map(trigger => (
                            <Badge key={trigger} variant="secondary" className="text-xs">{trigger.replace(/-/g, ' ')}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {operatingProfile.selfDescribedFriction && (
                      <p className="text-xs text-slate-500 dark:text-gray-400 italic mt-2">
                        "{operatingProfile.selfDescribedFriction}"
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-slate-500 dark:text-gray-400 mb-3">
                      You haven't set up your operating profile yet. It helps Naya understand how you work best.
                    </p>
                    <Button variant="outline" size="sm" onClick={handleOpenProfileEdit}>
                      <Zap className="h-3.5 w-3.5 mr-1.5" />
                      Set up your profile
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Brand DNA */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" /> {t('settings.brandDna')}
                </CardTitle>
                <CardDescription>The strategic profile Naya uses to generate all your content and tasks</CardDescription>
              </CardHeader>
              <CardContent>
                {brandDnaLoading ? (
                  <div className="flex items-center justify-center py-8 text-slate-400 dark:text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
                  </div>
                ) : !brandDna ? (
                  <p className="text-sm text-slate-500 dark:text-gray-400">Complete onboarding to set up your Brand DNA.</p>
                ) : (
                  <Tabs defaultValue="identity">
                    <TabsList className="grid w-full grid-cols-5 text-[11px]">
                      <TabsTrigger value="identity">{t('settings.tabs.identity')}</TabsTrigger>
                      <TabsTrigger value="offers">{t('settings.tabs.offersMarket')}</TabsTrigger>
                      <TabsTrigger value="content">{t('settings.tabs.contentPlatforms')}</TabsTrigger>
                      <TabsTrigger value="priorities">{t('settings.tabs.activePriorities')}</TabsTrigger>
                      <TabsTrigger value="intelligence">{t('settings.tabs.nayaIntelligence')}</TabsTrigger>
                    </TabsList>

                    {/* ── Identity ── */}
                    <TabsContent value="identity" className="space-y-4 pt-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Business / Brand name</Label>
                          <Input value={dnaBusinessName} onChange={e => setDnaBusinessName(e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Website</Label>
                          <Input value={dnaWebsite} onChange={e => setDnaWebsite(e.target.value)} placeholder="https://" className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">LinkedIn profile</Label>
                          <Input value={dnaLinkedin} onChange={e => setDnaLinkedin(e.target.value)} placeholder="linkedin.com/in/..." className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Instagram handle</Label>
                          <Input value={dnaInstagram} onChange={e => setDnaInstagram(e.target.value)} placeholder="@handle" className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Business type</Label>
                        <Input value={dnaBusinessType} onChange={e => setDnaBusinessType(e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Business model</Label>
                        <Input value={dnaBusinessModel} onChange={e => setDnaBusinessModel(e.target.value)} placeholder="e.g. services, products, SaaS…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unique positioning</Label>
                        <Textarea value={dnaUniquePositioning} onChange={e => setDnaUniquePositioning(e.target.value)} rows={2} className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Your authority level</Label>
                        <Select value={dnaAuthorityLevel} onValueChange={setDnaAuthorityLevel}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose a level" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="emerging">Emerging — building credibility</SelectItem>
                            <SelectItem value="established">Established — known in my niche</SelectItem>
                            <SelectItem value="authority">Authority — widely recognized</SelectItem>
                            <SelectItem value="thought-leader">Thought leader — industry voice</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="sm" onClick={() => patchBrandDna.mutate({ businessName: dnaBusinessName, website: dnaWebsite, linkedinProfile: dnaLinkedin, instagramHandle: dnaInstagram, businessType: dnaBusinessType, businessModel: dnaBusinessModel, uniquePositioning: dnaUniquePositioning, authorityLevel: dnaAuthorityLevel })} disabled={patchBrandDna.isPending}>
                        {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveIdentity')}
                      </Button>
                    </TabsContent>

                    {/* ── Offers & Market ── */}
                    <TabsContent value="offers" className="space-y-4 pt-4">
                      <div className="space-y-1">
                        <Label className="text-xs">What do you offer?</Label>
                        <Textarea value={dnaOffers} onChange={e => setDnaOffers(e.target.value)} rows={3} placeholder="Services, products, programs…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Price range</Label>
                        <Select value={dnaPriceRange} onValueChange={setDnaPriceRange}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose a range" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="under-500">Under €500 / project</SelectItem>
                            <SelectItem value="500-2000">€500 – €2,000</SelectItem>
                            <SelectItem value="2000-5000">€2,000 – €5,000</SelectItem>
                            <SelectItem value="5000-15000">€5,000 – €15,000</SelectItem>
                            <SelectItem value="15000-plus">€15,000+</SelectItem>
                            <SelectItem value="subscription">Subscription / recurring</SelectItem>
                            <SelectItem value="variable">Variable / depends on scope</SelectItem>
                            <SelectItem value="not-yet-set">Not set yet</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Client journey (discovery → purchase)</Label>
                        <Textarea value={dnaClientJourney} onChange={e => setDnaClientJourney(e.target.value)} rows={2} placeholder="How clients find and buy from you…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Competitive landscape</Label>
                        <Textarea value={dnaCompetitorLandscape} onChange={e => setDnaCompetitorLandscape(e.target.value)} rows={2} placeholder="Who you're different from and how…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Target audience</Label>
                        <Textarea value={dnaTargetAudience} onChange={e => setDnaTargetAudience(e.target.value)} rows={2} placeholder="Who you serve — role, context, mindset…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Core audience pain point</Label>
                        <Textarea value={dnaCorePainPoint} onChange={e => setDnaCorePainPoint(e.target.value)} rows={2} placeholder="The #1 frustration or struggle your audience faces…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Audience aspiration</Label>
                        <Textarea value={dnaAudienceAspiration} onChange={e => setDnaAudienceAspiration(e.target.value)} rows={2} placeholder="What your audience most wants to achieve…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <Button size="sm" onClick={() => patchBrandDna.mutate({ offers: dnaOffers, priceRange: dnaPriceRange, clientJourney: dnaClientJourney, competitorLandscape: dnaCompetitorLandscape, targetAudience: dnaTargetAudience, corePainPoint: dnaCorePainPoint, audienceAspiration: dnaAudienceAspiration })} disabled={patchBrandDna.isPending}>
                        {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveOffersMarket')}
                      </Button>
                    </TabsContent>

                    {/* ── Content & Platforms ── */}
                    <TabsContent value="content" className="space-y-4 pt-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Brand voice keywords (up to 6)</Label>
                        <p className="text-[11px] text-slate-400 dark:text-gray-500">Press Enter or comma to add</p>
                        <KeywordChipInput values={dnaVoiceKw} onChange={setDnaVoiceKw} max={6} placeholder="e.g. direct, warm, precise…" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Words / tones to avoid (up to 4)</Label>
                        <KeywordChipInput values={dnaAntiKw} onChange={setDnaAntiKw} max={4} placeholder="e.g. corporate, salesy, jargon…" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Editorial territory</Label>
                        <Textarea value={dnaEditorialTerritory} onChange={e => setDnaEditorialTerritory(e.target.value)} rows={2} placeholder="The intersection of brand and psychology…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Content pillars</Label>
                        <p className="text-[11px] text-slate-400 dark:text-gray-500">Define each pillar with its formats and publishing frequency</p>
                        <PillarListEditor pillars={dnaContentPillarsDetailed} onChange={setDnaContentPillarsDetailed} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Primary platform</Label>
                        <Select value={dnaPlatformPriority} onValueChange={setDnaPlatformPriority}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose primary platform" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="linkedin">LinkedIn</SelectItem>
                            <SelectItem value="instagram">Instagram</SelectItem>
                            <SelectItem value="twitter">X / Twitter</SelectItem>
                            <SelectItem value="newsletter">Newsletter / Email</SelectItem>
                            <SelectItem value="youtube">YouTube</SelectItem>
                            <SelectItem value="tiktok">TikTok</SelectItem>
                            <SelectItem value="podcast">Podcast</SelectItem>
                            <SelectItem value="blog">Blog / SEO</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Communication style</Label>
                        <Select value={dnaCommunicationStyle} onValueChange={setDnaCommunicationStyle}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose style" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="conversational">Conversational — warm and approachable</SelectItem>
                            <SelectItem value="authoritative">Authoritative — direct and confident</SelectItem>
                            <SelectItem value="educational">Educational — clear and structured</SelectItem>
                            <SelectItem value="inspirational">Inspirational — motivating and visionary</SelectItem>
                            <SelectItem value="provocative">Provocative — challenges assumptions</SelectItem>
                            <SelectItem value="storytelling">Storytelling — narrative-driven</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Current online presence</Label>
                        <Select value={dnaCurrentPresence} onValueChange={setDnaCurrentPresence}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose presence level" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None — starting from scratch</SelectItem>
                            <SelectItem value="minimal">Minimal — basic profiles only</SelectItem>
                            <SelectItem value="growing">Growing — some followers/readers</SelectItem>
                            <SelectItem value="established">Established — consistent audience</SelectItem>
                            <SelectItem value="strong">Strong — large engaged following</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Content bandwidth</Label>
                        <Select value={dnaContentBandwidth} onValueChange={setDnaContentBandwidth}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="How much can you publish?" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minimal">Minimal — 1–2 posts/week max</SelectItem>
                            <SelectItem value="moderate">Moderate — 3–5 pieces/week</SelectItem>
                            <SelectItem value="active">Active — daily content</SelectItem>
                            <SelectItem value="high-volume">High volume — multiple per day</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Visual identity notes</Label>
                        <Textarea value={dnaVisualIdentityNotes} onChange={e => setDnaVisualIdentityNotes(e.target.value)} rows={2} placeholder="e.g. minimal, warm tones, no stock photos…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Reference brands (up to 5)</Label>
                        <p className="text-[11px] text-slate-400 dark:text-gray-500">Brands whose style or approach you admire</p>
                        <KeywordChipInput values={dnaReferenceBrands} onChange={setDnaReferenceBrands} max={5} placeholder="e.g. Notion, Basecamp, Figma…" />
                      </div>
                      <Button size="sm" onClick={() => patchBrandDna.mutate({ brandVoiceKeywords: dnaVoiceKw, brandVoiceAntiKeywords: dnaAntiKw, editorialTerritory: dnaEditorialTerritory, contentPillarsDetailed: dnaContentPillarsDetailed, platformPriority: dnaPlatformPriority, communicationStyle: dnaCommunicationStyle, currentPresence: dnaCurrentPresence, contentBandwidth: dnaContentBandwidth, visualIdentityNotes: dnaVisualIdentityNotes, referenceBrands: dnaReferenceBrands })} disabled={patchBrandDna.isPending}>
                        {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveContentPlatforms')}
                      </Button>
                    </TabsContent>

                    {/* ── Active Priorities ── */}
                    <TabsContent value="priorities" className="space-y-4 pt-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Active business priority</Label>
                        <Input value={dnaActiveBusinessPriority} onChange={e => setDnaActiveBusinessPriority(e.target.value)} placeholder="e.g. close 2 new clients, launch newsletter…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Current business stage</Label>
                        <Select value={dnaCurrentBusinessStage} onValueChange={setDnaCurrentBusinessStage}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose a stage" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="idea">Idea / pre-launch</SelectItem>
                            <SelectItem value="launch">Launched / early traction</SelectItem>
                            <SelectItem value="growing">Growing</SelectItem>
                            <SelectItem value="scaling">Scaling</SelectItem>
                            <SelectItem value="established">Established</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Revenue urgency</Label>
                        <Select value={dnaRevenueUrgency} onValueChange={setDnaRevenueUrgency}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose urgency" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="revenue-now">Need revenue now — critical</SelectItem>
                            <SelectItem value="3-months">Within 3 months</SelectItem>
                            <SelectItem value="growing-steadily">Growing steadily — not urgent</SelectItem>
                            <SelectItem value="authority-building">Building authority first</SelectItem>
                            <SelectItem value="scale-existing">Scaling what's already working</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Revenue target</Label>
                        <Input value={dnaRevenueTarget} onChange={e => setDnaRevenueTarget(e.target.value)} placeholder="e.g. €5k/month by Q3" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Key milestones</Label>
                        <p className="text-[11px] text-slate-400 dark:text-gray-500">Track each milestone with a target date and status</p>
                        <MilestoneListEditor milestones={dnaKeyMilestones} onChange={setDnaKeyMilestones} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Primary goal</Label>
                        <Textarea value={dnaPrimaryGoal} onChange={e => setDnaPrimaryGoal(e.target.value)} rows={2} className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Success definition</Label>
                        <Textarea value={dnaSuccessDefinition} onChange={e => setDnaSuccessDefinition(e.target.value)} rows={2} className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Current challenges</Label>
                        <Textarea value={dnaCurrentChallenges} onChange={e => setDnaCurrentChallenges(e.target.value)} rows={2} className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Team structure</Label>
                        <Select value={dnaTeamStructure} onValueChange={setDnaTeamStructure}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose team structure" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="solo">Solo founder — I work alone</SelectItem>
                            <SelectItem value="solo-contractors">Solo + contractors as needed</SelectItem>
                            <SelectItem value="2-3-person">2–3 person team</SelectItem>
                            <SelectItem value="small-team">Small team (4–10)</SelectItem>
                            <SelectItem value="growing-team">Growing team (10+)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Operational constraints</Label>
                        <Textarea value={dnaOperationalConstraints} onChange={e => setDnaOperationalConstraints(e.target.value)} rows={2} placeholder="e.g. limited time (10h/week), no team support, budget under €500…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Geographic focus</Label>
                        <Select value={dnaGeographicFocus} onValueChange={setDnaGeographicFocus}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder="Choose geographic focus" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="local">Local / city</SelectItem>
                            <SelectItem value="national">National</SelectItem>
                            <SelectItem value="europe">Europe</SelectItem>
                            <SelectItem value="english-speaking">English-speaking markets</SelectItem>
                            <SelectItem value="global">Global</SelectItem>
                            <SelectItem value="remote-global">Remote / fully global</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Language strategy</Label>
                        <Input value={dnaLanguageStrategy} onChange={e => setDnaLanguageStrategy(e.target.value)} placeholder="e.g. English only, bilingual EN/FR…" className="dark:bg-gray-800 dark:border-gray-600" />
                      </div>
                      <Button size="sm" onClick={() => patchBrandDna.mutate({ activeBusinessPriority: dnaActiveBusinessPriority, currentBusinessStage: dnaCurrentBusinessStage, revenueUrgency: dnaRevenueUrgency, revenueTarget: dnaRevenueTarget, keyMilestones: dnaKeyMilestones, primaryGoal: dnaPrimaryGoal, successDefinition: dnaSuccessDefinition, currentChallenges: dnaCurrentChallenges, teamStructure: dnaTeamStructure, operationalConstraints: dnaOperationalConstraints, geographicFocus: dnaGeographicFocus, languageStrategy: dnaLanguageStrategy })} disabled={patchBrandDna.isPending}>
                        {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveActivePriorities')}
                      </Button>
                    </TabsContent>

                    {/* ── Naya Intelligence ── */}
                    <TabsContent value="intelligence" className="space-y-4 pt-4">
                      <div className="rounded-xl bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/10 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-primary uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5" /> {t('settings.strategicSummary')}
                          </p>
                          {brandDna.lastStrategyRefreshAt && (
                            <span className="text-[10px] text-slate-400 dark:text-gray-500">
                              Last updated: {new Date(brandDna.lastStrategyRefreshAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {brandDna.nayaIntelligenceSummary ? (
                          <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                            {brandDna.nayaIntelligenceSummary}
                          </p>
                        ) : (
                          <p className="text-sm text-slate-400 dark:text-gray-500 italic">
                            {t('settings.noStrategicSummary')}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => refreshIntelligence.mutate()}
                        disabled={refreshIntelligence.isPending}
                        className="w-full"
                      >
                        {refreshIntelligence.isPending ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('settings.analysingBrand')}</>
                        ) : (
                          <><Sparkles className="h-4 w-4 mr-2" />{t('settings.refreshAnalysis')}</>
                        )}
                      </Button>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>

            {/* Google Calendar */}
            <GoogleCalendarCard />

            {/* Réseaux sociaux */}
            <SocialConnectionsCard />

            {/* Data & Reset */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="h-4 w-4" /> {t('settings.dangerZone')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-900 dark:text-white">{t('settings.resetData')}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      {t('settings.resetDataDescription')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResetConfirmOpen(true)}
                  >
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Sign out */}
            <Card className="dark:bg-gray-900 dark:border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LogOut className="h-4 w-4" /> {t('settings.logOut')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-600 dark:text-gray-400">
                    {t('settings.logOut')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { window.location.href = "/api/logout"; }}
                  >
                    {t('settings.logOut')}
                  </Button>
                </div>
              </CardContent>
            </Card>

          </div>
        </main>
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              {t('settings.confirmReset')}
            </DialogTitle>
            <DialogDescription>
              This is a full workspace reset. It will permanently delete your projects, goals, tasks, personas, and all onboarding-generated data. Your account stays, but your board will be completely cleared.
              You'll go through onboarding again to rebuild from scratch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => { setResetConfirmOpen(false); resetOnboardingMutation.mutate(); }}
              disabled={resetOnboardingMutation.isPending}
            >
              {resetOnboardingMutation.isPending ? t('common.loading') : t('settings.confirmReset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Operating profile edit dialog */}
      <Dialog open={profileEditOpen} onOpenChange={setProfileEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('settings.operatingProfile')}</DialogTitle>
            <DialogDescription>
              This helps Naya understand your working style and adapt how it frames tasks and support.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>When do you do your best work?</Label>
              <Select
                value={profileDraft.energyRhythm || ''}
                onValueChange={v => setProfileDraft(p => ({ ...p, energyRhythm: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Choose your energy rhythm" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning-person">Morning — I'm sharpest early</SelectItem>
                  <SelectItem value="afternoon-peak">Afternoon — I warm up slowly</SelectItem>
                  <SelectItem value="evening-owl">Evening — I come alive later</SelectItem>
                  <SelectItem value="variable">It varies — depends on the day</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>How do you prefer to plan?</Label>
              <Select
                value={profileDraft.planningStyle || ''}
                onValueChange={v => setProfileDraft(p => ({ ...p, planningStyle: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Choose your planning style" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="visual">Visual — I need to see it to believe it</SelectItem>
                  <SelectItem value="list">List-based — I love a clean checklist</SelectItem>
                  <SelectItem value="time-blocked">Time-blocked — I schedule everything</SelectItem>
                  <SelectItem value="flexible">Flexible — I loosely plan and adapt</SelectItem>
                  <SelectItem value="spontaneous">Spontaneous — I follow my energy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>What helps you start tasks?</Label>
              <Select
                value={profileDraft.activationStyle || ''}
                onValueChange={v => setProfileDraft(p => ({ ...p, activationStyle: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Choose your activation style" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="smallest-next-step">Smallest next step — just begin somewhere tiny</SelectItem>
                  <SelectItem value="big-picture-first">Big picture first — remind me why it matters</SelectItem>
                  <SelectItem value="deadline-pressure">Deadline pressure — urgency helps me focus</SelectItem>
                  <SelectItem value="external-accountability">External accountability — I work better with others</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>What kind of encouragement helps you?</Label>
              <Select
                value={profileDraft.encouragementStyle || ''}
                onValueChange={v => setProfileDraft(p => ({ ...p, encouragementStyle: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Choose your encouragement style" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct-and-brief">Direct and brief — just tell me what to do</SelectItem>
                  <SelectItem value="warm-and-supportive">Warm and supportive — I need to feel it's okay</SelectItem>
                  <SelectItem value="structured-framework">Structured framework — give me a system</SelectItem>
                  <SelectItem value="reframe-and-question">Reframe or question — help me think differently</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>What kinds of tasks do you tend to avoid?</Label>
              <div className="grid grid-cols-1 gap-2">
                {AVOIDANCE_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => handleAvoidanceTriggerToggle(opt.value)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                      (profileDraft.avoidanceTriggers || []).includes(opt.value)
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 hover:border-slate-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      (profileDraft.avoidanceTriggers || []).includes(opt.value)
                        ? 'border-primary bg-primary'
                        : 'border-slate-300 dark:border-gray-600'
                    }`}>
                      {(profileDraft.avoidanceTriggers || []).includes(opt.value) && (
                        <span className="text-white text-[10px] leading-none">✓</span>
                      )}
                    </div>
                    {opt.label}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Anything else that usually gets in your way? (Optional)</Label>
              <Textarea
                placeholder="e.g. I always overthink the first sentence / I get distracted when I'm not in a specific mood..."
                rows={3}
                value={profileDraft.selfDescribedFriction || ''}
                onChange={e => setProfileDraft(p => ({ ...p, selfDescribedFriction: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileEditOpen(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => updateProfileMutation.mutate(profileDraft)}
              disabled={updateProfileMutation.isPending}
            >
              {updateProfileMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
