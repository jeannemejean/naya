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
import { Sun, Moon, LogOut, RefreshCw, AlertTriangle, User, Zap, Brain, Clock, Calendar, Loader2, CheckCircle2, Link2Off, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import type { UserOperatingProfile, UserPreferences } from "@shared/schema";


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
 <Calendar className="h-4 w-4 text-naya-salvia" />
 Google Calendar
 </CardTitle>
 <CardDescription>
 Affiche tes rendez-vous dans le planning et bloque les créneaux pendant les réunions.
 </CardDescription>
 </CardHeader>
 <CardContent>
 {status?.connected ? (
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2 text-sm text-naya-olive ">
 <span className="w-2 h-2 rounded-full bg-naya-olive-060 inline-block" />
 Connecté — événements synchronisés
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={() => disconnectMutation.mutate()}
 disabled={disconnectMutation.isPending}
 className="text-[#5c3d45] border-[rgba(158,126,135,0.35)] hover:bg-[rgba(158,126,135,0.12)] "
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
 name: 'Meta',
 description: 'Publie sur Instagram et Facebook, gère tes campagnes.',
 gradient: 'from-blue-600 via-indigo-600 to-blue-800',
 Icon: () => (
 <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
 <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
 </svg>
 ),
 },
 {
 id: 'linkedin' as const,
 name: 'LinkedIn',
 description: 'Publie sur ton profil et tes pages entreprise.',
 gradient: 'from-blue-600 to-blue-700',
 Icon: () => (
 <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
 <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
 </svg>
 ),
 },
 {
 id: 'tiktok' as const,
 name: 'TikTok',
 description: 'Publie tes vidéos courtes sur TikTok.',
 gradient: 'from-neutral-800 to-black',
 Icon: () => (
 <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
 <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
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

 // Comptes connectés détaillés (pour afficher les Pages LinkedIn entreprise).
 const { data: accounts = [] } = useQuery<Array<{ id: number; platform: string; basePlatform: string; accountName: string; isPage: boolean }>>({
 queryKey: ['/api/social/accounts'],
 retry: false,
 });
 const linkedinPages = accounts.filter((a) => a.isPage);

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
 className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
 >
 {/* Logo */}
 <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white flex-shrink-0`}>
 <Icon />
 </div>

 {/* Infos */}
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground">{name}</p>
 {isConnected ? (
 <p className="text-xs text-naya-olive flex items-center gap-1 mt-0.5">
 <CheckCircle2 className="h-3 w-3" />
 {info?.accountName || 'Connecté'}
 </p>
 ) : (
 <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
 )}
 {!isConfigured && (
 <p className="text-xs text-naya-sulphur mt-0.5">Variables d'env manquantes</p>
 )}
 {/* Pages entreprise LinkedIn connectées */}
 {id === 'linkedin' && isConnected && (
 linkedinPages.length > 0 ? (
 <div className="mt-1.5 flex flex-wrap gap-1">
 {linkedinPages.map((p) => (
 <span key={p.id} className="text-[10px] px-2 py-0.5 rounded-full bg-naya-olive-06 text-naya-olive-70 border border-naya-olive-10 flex items-center gap-1">
 <CheckCircle2 className="h-2.5 w-2.5" /> {p.accountName}
 </span>
 ))}
 </div>
 ) : (
 <p className="text-[11px] text-naya-olive-35 mt-1">Aucune page entreprise détectée — reconnecte LinkedIn en autorisant l'accès à tes Pages.</p>
 )
 )}
 </div>

 {/* Action */}
 {isConnected ? (
 <Button
 variant="outline"
 size="sm"
 className="text-[#5c3d45] border-[rgba(158,126,135,0.35)] hover:bg-[rgba(158,126,135,0.12)] flex-shrink-0"
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
 const { user, logout } = useAuth();
 const { theme, toggleTheme } = useTheme();
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const [, setLocation] = useLocation();
 const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
 const [profileEditOpen, setProfileEditOpen] = useState(false);
 const [replanDate, setReplanDate] = useState('');
 const [replanConfirmOpen, setReplanConfirmOpen] = useState(false);

 const replanMutation = useMutation({
   mutationFn: (fromDate: string) =>
     apiRequest('POST', '/api/planning/reset', { fromDate }).then(r => r.json()),
   onSuccess: (data: any) => {
     queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
     queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
     setReplanConfirmOpen(false);
     setLocation('/');
     setTimeout(() => {
       window.dispatchEvent(new CustomEvent('naya:open-companion', {
         detail: { message: "On repart de zéro. Avant de replanifier, dis-moi : est-ce que tes objectifs ou projets ont changé depuis la dernière fois ?" }
       }));
     }, 300);
   },
   onError: () => toast({ title: t('common.error'), variant: 'destructive' }),
 });

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
 <header className="bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
 <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
 <h1 className="text-xl font-bold tracking-tight text-foreground">{t('settings.title')}</h1>
 <p className="text-sm text-muted-foreground mt-0.5">{t('settings.subtitle')}</p>
 </header>

 <main className="flex-1 overflow-y-auto p-6">
 <div className="max-w-2xl mx-auto space-y-6">

 {/* Account */}
 <Card className=" ">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <User className="h-4 w-4" /> {t('settings.profile')}
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
 <span className="text-white">
 {user?.firstName?.charAt(0) || user?.email?.charAt(0) || "U"}
 </span>
 </div>
 <div>
 <p className="font-medium text-foreground">
 {user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.firstName || user?.email || "User"}
 </p>
 <p className="text-sm text-naya-olive-55">{user?.email}</p>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Appearance */}
 <Card className=" ">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {t('settings.theme')}
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-foreground">{t('settings.dark')}</p>
 <p className="text-xs text-naya-olive-55">
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
 <Card className=" ">
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
 <p className="text-xs text-naya-olive-55">
 Naya ne génère aucune tâche et ne déplace rien avant cette date. Laisse vide pour démarrer immédiatement.
 </p>
 <div className="flex items-center gap-2">
 <input
 type="date"
 value={planningStartDate}
 onChange={e => setPlanningStartDate(e.target.value)}
 className="text-sm px-3 py-1.5 rounded-md border border-naya-olive-18 bg-white text-naya-olive-70 "
 />
 {planningStartDate && (
 <button
 onClick={() => setPlanningStartDate('')}
 className="text-xs text-naya-olive-35 hover:text-naya-olive-55 :text-naya-olive-18 underline"
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
 : 'bg-naya-olive-10 text-naya-olive-55 border-naya-olive-18 hover:border-naya-olive-18 :border-naya-olive-35'
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
 <span className="text-sm text-naya-olive-55">to</span>
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
 <span className="text-sm text-naya-olive-55">to</span>
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
 <Card className=" ">
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
 <span className="text-naya-olive-55 w-36">{t('settings.energyRhythm')}</span>
 <Badge variant="outline" className="text-xs">{operatingProfile.energyRhythm.replace(/-/g, ' ')}</Badge>
 </div>
 )}
 {operatingProfile.planningStyle && (
 <div className="flex items-center gap-2 text-sm">
 <span className="text-naya-olive-55 w-36">{t('settings.planningStyle')}</span>
 <Badge variant="outline" className="text-xs">{operatingProfile.planningStyle}</Badge>
 </div>
 )}
 {operatingProfile.activationStyle && (
 <div className="flex items-center gap-2 text-sm">
 <span className="text-naya-olive-55 w-36">{t('settings.activationStyle')}</span>
 <Badge variant="outline" className="text-xs">{operatingProfile.activationStyle.replace(/-/g, ' ')}</Badge>
 </div>
 )}
 {operatingProfile.avoidanceTriggers && operatingProfile.avoidanceTriggers.length > 0 && (
 <div className="flex items-start gap-2 text-sm">
 <span className="text-naya-olive-55 w-36 mt-0.5">{t('settings.avoidanceTriggers')}</span>
 <div className="flex flex-wrap gap-1">
 {operatingProfile.avoidanceTriggers.map(trigger => (
 <Badge key={trigger} variant="secondary" className="text-xs">{trigger.replace(/-/g, ' ')}</Badge>
 ))}
 </div>
 </div>
 )}
 {operatingProfile.selfDescribedFriction && (
 <p className="text-xs text-naya-olive-55 italic mt-2">
 "{operatingProfile.selfDescribedFriction}"
 </p>
 )}
 </div>
 ) : (
 <div className="text-center py-4">
 <p className="text-sm text-naya-olive-55 mb-3">
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


 {/* Google Calendar */}
 <GoogleCalendarCard />

 {/* Réseaux sociaux */}
 <SocialConnectionsCard />

 {/* Replanifier depuis zéro */}
 <Card className=" ">
   <CardHeader>
     <CardTitle className="flex items-center gap-2 text-base">
       <Calendar className="h-4 w-4" /> Replanifier depuis zéro
     </CardTitle>
     <CardDescription className="text-xs text-naya-olive-55">
       Archive toutes les tâches futures non complétées et régénère ton planning depuis une nouvelle date.
     </CardDescription>
   </CardHeader>
   <CardContent className="space-y-3">
     <div className="flex items-end gap-3">
       <div className="flex-1 space-y-1">
         <Label className="text-xs text-naya-olive-70">Date de démarrage</Label>
         <Input
           type="date"
           value={replanDate}
           onChange={e => setReplanDate(e.target.value)}
           className="text-sm"
           min={new Date().toISOString().slice(0, 10)}
         />
       </div>
       <Button
         size="sm"
         variant="outline"
         disabled={!replanDate || replanMutation.isPending}
         onClick={() => setReplanConfirmOpen(true)}
       >
         Lancer la replanification
       </Button>
     </div>
   </CardContent>
 </Card>

 {/* Data & Reset */}
 <Card className=" ">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <RefreshCw className="h-4 w-4" /> {t('settings.dangerZone')}
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-foreground">{t('settings.resetData')}</p>
 <p className="text-xs text-naya-olive-55">
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

 {/* Email d'envoi de prospection */}
 <ProspectionSenderCard />

 {/* Abonnement */}
 <Card className=" ">
 <CardHeader>
 <CardTitle className="text-base">Abonnement</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-center justify-between">
 <p className="text-sm text-naya-olive-70">
 Gère ton abonnement, ton moyen de paiement et tes factures.
 </p>
 <Button
 variant="outline"
 size="sm"
 onClick={async () => {
 try {
 const res = await fetch('/api/billing/portal', { method: 'POST', credentials: 'include' });
 const data = await res.json();
 if (data?.url) { window.location.href = data.url; return; }
 if (data?.message === 'no_customer') {
 toast({ title: "Aucun abonnement à gérer", description: "Ton compte est en accès propriétaire/offert — il n'y a pas d'abonnement payant associé." });
 } else {
 toast({ title: "Indisponible", description: "Impossible d'ouvrir la gestion d'abonnement pour le moment.", variant: "destructive" });
 }
 } catch {
 toast({ title: "Erreur", description: "Réessaie dans un instant.", variant: "destructive" });
 }
 }}
 >
 Gérer mon abonnement
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Sign out */}
 <Card className=" ">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <LogOut className="h-4 w-4" /> {t('settings.logOut')}
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-center justify-between">
 <p className="text-sm text-naya-olive-70">
 {t('settings.logOut')}
 </p>
 <Button
 variant="outline"
 size="sm"
 onClick={logout}
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
 <AlertTriangle className="h-5 w-5 text-naya-sulphur" />
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

 {/* Replan confirmation dialog */}
 <Dialog open={replanConfirmOpen} onOpenChange={setReplanConfirmOpen}>
   <DialogContent>
     <DialogHeader>
       <DialogTitle className="flex items-center gap-2">
         <AlertTriangle className="h-5 w-5 text-naya-sulphur" />
         Confirmer la replanification
       </DialogTitle>
       <DialogDescription>
         Toutes tes tâches futures non complétées seront archivées (pas supprimées). Naya va ensuite t'aider à reconstruire ton planning depuis le {replanDate}.
       </DialogDescription>
     </DialogHeader>
     <DialogFooter>
       <Button variant="outline" onClick={() => setReplanConfirmOpen(false)}>{t('common.cancel')}</Button>
       <Button
         onClick={() => replanMutation.mutate(replanDate)}
         disabled={replanMutation.isPending}
       >
         {replanMutation.isPending ? t('common.loading') : 'Replanifier'}
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
 : 'border-naya-olive-18 text-naya-olive-70 hover:border-naya-olive-18 :border-naya-olive-35'
 }`}
 >
 <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
 (profileDraft.avoidanceTriggers || []).includes(opt.value)
 ? 'border-primary bg-primary'
 : 'border-naya-olive-18 '
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

// ─── Carte : email d'envoi de prospection (propre à l'utilisateur) ──────────
function ProspectionSenderCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<{
    senderEmail: string; senderName: string; address: string; city: string; country: string;
    hasOwnKey: boolean; verificationStatus: string;
  }>({ queryKey: ["/api/prospection/sender"] });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const loaded = useState({ done: false })[0];

  useEffect(() => {
    if (data && !loaded.done) {
      loaded.done = true;
      setEmail(data.senderEmail || "");
      setName(data.senderName || "");
      setAddress(data.address || "");
      setCity(data.city || "");
      setCountry(data.country || "");
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/prospection/sender", {
        senderEmail: email, senderName: name, address, city, country,
      }).then((r) => r.json()),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospection/sender"] });
      if (res.verificationTriggered) {
        toast({ title: "📩 Email de vérification envoyé", description: `Clique le lien reçu sur ${email} pour activer l'envoi.` });
      } else if (res.verificationStatus === "verified") {
        toast({ title: "✅ Adresse vérifiée", description: "Tes prospections partiront de cette adresse." });
      } else {
        toast({ title: "Enregistré", description: "Renseigne l'adresse postale pour lancer la vérification." });
      }
    },
    onError: () => toast({ title: "Erreur", description: "Enregistrement impossible.", variant: "destructive" }),
  });

  const resend = useMutation({
    mutationFn: () => apiRequest("POST", "/api/prospection/sender/verify").then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospection/sender"] });
      toast({ title: "📩 Email de vérification renvoyé", description: `Vérifie la boîte ${email}.` });
    },
    onError: () => toast({ title: "Erreur", description: "Renseigne l'adresse postale d'abord.", variant: "destructive" }),
  });

  const status = data?.verificationStatus;
  const statusBadge =
    status === "verified" ? { label: "✅ Vérifiée", cls: "bg-naya-olive-10 text-naya-olive" }
    : status === "pending" ? { label: "📩 En attente de validation", cls: "bg-[rgba(212,201,122,0.20)] text-[#5a4f0d]" }
    : { label: "⚠️ Non vérifiée", cls: "bg-[rgba(158,126,135,0.15)] text-[#5c3d45]" };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Email d'envoi (prospection)
          {data?.senderEmail && <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>}
        </CardTitle>
        <CardDescription>
          Tes campagnes partent de TON adresse. On t'envoie un email de vérification (SendGrid) à valider en 1 clic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Adresse expéditrice</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jeanne@agence-jmd.com" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nom affiché</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jeanne Méjean" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1 col-span-3">
            <Label className="text-xs">Adresse postale (requise par SendGrid / loi anti-spam)</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 rue de la République" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Ville</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lyon" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pays</Label>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="France" />
          </div>
        </div>
        <div className="flex justify-between items-center">
          {status === "pending" ? (
            <Button variant="outline" size="sm" disabled={resend.isPending} onClick={() => resend.mutate()}>
              {resend.isPending ? "…" : "Renvoyer l'email de vérification"}
            </Button>
          ) : <span />}
          <Button size="sm" disabled={save.isPending || !email.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
