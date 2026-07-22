import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/fetchJson";
import { useProject } from "@/lib/project-context";
import { Plus, Target, TrendingUp, Star, Settings, CheckCircle2, Circle, Archive, Loader2, Clock, Sparkles, Dna } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { BrandDnaEditor } from "@/components/brand-dna-editor";
import MilestoneRoadmap from "@/pages/project/MilestoneRoadmap";
import type { Project, ProjectGoal, Client, Task } from "@shared/schema";

const createClientSchema = z.object({
 name: z.string().min(1, "Client name is required"),
 contactName: z.string().optional(),
 email: z.string().email("Invalid email").optional().or(z.literal("")),
 lifecycleStage: z.string().default("active"),
 urgencyLevel: z.string().default("medium"),
});

const PROJECT_COLORS = [
 "#6366f1", "#8b5cf6", "#ec4899", "#f97316", 
 "#10b981", "#06b6d4", "#f59e0b", "#64748b"
];

const PROJECT_TYPE_ICONS: Record<string, string> = {
 "Business": "▶",
 "Personal Brand": "◇",
 "Passion Project": "◯",
 "Client Project": "▷",
 "Agency": "◆",
 "Internal": "—",
 "Lifestyle": "◇",
};

const MONETIZATION_LABELS: Record<string, { label: string; color: string }> = {
 "revenue-now": { label: "Revenue Now", color: "bg-[rgba(158,126,135,0.20)] text-[#5c3d45] " },
 "authority-building": { label: "Authority Building", color: "bg-[rgba(125,143,168,0.20)] text-[#354963] " },
 "exploratory": { label: "Exploratory", color: "bg-[rgba(212,201,122,0.20)] text-[#5a4f0d] " },
 "none": { label: "Non-commercial", color: "bg-naya-olive-10 text-naya-olive " },
};

const SUCCESS_MODE_LABELS: Record<string, string> = {
 "revenue": "◆ Revenue",
 "visibility": "◇ Visibility",
 "consistency": "▶ Consistency",
 "exploration": "▷ Exploration",
 "learning": "— Learning",
 "wellbeing": "◯ Wellbeing",
};

const createProjectSchema = z.object({
 name: z.string().min(1, "Project name is required"),
 type: z.string().min(1, "Project type is required"),
 description: z.string().optional(),
 monetizationIntent: z.string().default("exploratory"),
 priorityLevel: z.string().default("secondary"),
 category: z.string().optional(),
 dailyTimeBudgetHours: z.coerce.number().int().min(0).max(16).optional(),
 icon: z.string().default("◇"),
 color: z.string().default("#6366f1"),
 // Perso vs client (axe orthogonal à type/category). Les champs client ne sont
 // pertinents que si projectKind === 'client' (clientName alors obligatoire).
 projectKind: z.enum(["personal", "client"]).default("personal"),
 clientName: z.string().optional(),
 clientContact: z.string().optional(),
 clientBrief: z.string().optional(),
}).refine(
 (d) => d.projectKind !== "client" || !!(d.clientName && d.clientName.trim()),
 { message: "Le nom du client est obligatoire pour un projet client", path: ["clientName"] },
);

const createGoalSchema = z.object({
 title: z.string().min(1, "Goal title is required"),
 description: z.string().optional(),
 goalType: z.string().default("monthly"),
 successMode: z.string().default("visibility"),
 targetValue: z.string().optional(),
 timeframe: z.string().optional(),
 dueDate: z.string().optional(),
});

const TYPE_ICONS: Record<string, string> = {
 content: '—', outreach: '◇', admin: '▷', planning: '→',
};
const CATEGORY_COLORS: Record<string, string> = {
 trust: 'bg-secondary/10 text-secondary',
 conversion: 'bg-accent/10 text-accent',
 engagement: 'bg-info/10 text-info',
 visibility: 'bg-primary/10 text-primary',
 planning: 'bg-[rgba(158,126,135,0.20)] text-[#5c3d45] ',
};

function ClientsTab({ project }: { project: Project }) {
 const { t } = useTranslation();
 const queryClient = useQueryClient();
 const { toast } = useToast();
 const [addOpen, setAddOpen] = useState(false);
 const [expandedClientId, setExpandedClientId] = useState<number | null>(null);

 const { data: clients = [], isLoading } = useQuery<Client[]>({
 queryKey: ["/api/clients", { projectId: project.id }],
 queryFn: async () => {
 return fetchJson(`/api/clients?projectId=${project.id}`);
 }
 });

 const createMutation = useMutation({
 mutationFn: (data: z.infer<typeof createClientSchema>) =>
 apiRequest("POST", "/api/clients", { ...data, parentProjectId: project.id }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/clients", { projectId: project.id }] });
 setAddOpen(false);
 form.reset();
 toast({ title: t('settings.saved') });
 },
 onError: () => toast({ title: t('common.error'), variant: "destructive" }),
 });

 const form = useForm<z.infer<typeof createClientSchema>>({
 resolver: zodResolver(createClientSchema),
 defaultValues: {
 name: "",
 contactName: "",
 email: "",
 lifecycleStage: "active",
 urgencyLevel: "medium",
 }
 });

 if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-naya-olive-35" /></div>;

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <h3 className="text-lg text-foreground">{t('projects.clients')}</h3>
 <Dialog open={addOpen} onOpenChange={setAddOpen}>
 <DialogTrigger asChild>
 <Button size="sm" className="gap-2">
 <Plus className="h-4 w-4" />
 {t('projects.addClient')}
 </Button>
 </DialogTrigger>
 <DialogContent>
 <DialogHeader>
 <DialogTitle>{t('projects.addClient')}</DialogTitle>
 </DialogHeader>
 <Form {...form}>
 <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
 <FormField
 control={form.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Client Name</FormLabel>
 <FormControl><Input placeholder="Company Name" {...field} /></FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="contactName"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Contact Name</FormLabel>
 <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="email"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Email</FormLabel>
 <FormControl><Input type="email" placeholder="john@example.com" {...field} /></FormControl>
 </FormItem>
 )}
 />
 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={form.control}
 name="lifecycleStage"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Lifecycle Stage</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="onboarding">Onboarding</SelectItem>
 <SelectItem value="active">Active</SelectItem>
 <SelectItem value="retention">Retention</SelectItem>
 <SelectItem value="campaign">Campaign</SelectItem>
 <SelectItem value="offboarding">Offboarding</SelectItem>
 </SelectContent>
 </Select>
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="urgencyLevel"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Urgency</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="low">Low</SelectItem>
 <SelectItem value="medium">Medium</SelectItem>
 <SelectItem value="high">High</SelectItem>
 <SelectItem value="critical">Critical</SelectItem>
 </SelectContent>
 </Select>
 </FormItem>
 )}
 />
 </div>
 <Button type="submit" className="w-full" disabled={createMutation.isPending}>
 {createMutation.isPending ? t('common.loading') : t('projects.addClient')}
 </Button>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </div>

 <div className="grid gap-4">
 {clients.length === 0 ? (
 <div className="text-center py-12 border-2 border-dashed rounded-lg">
 <p className="text-naya-cream0">No clients in this project yet.</p>
 </div>
 ) : (
 clients.map(client => (
 <ClientCard 
 key={client.id} 
 client={client} 
 isExpanded={expandedClientId === client.id}
 onToggle={() => setExpandedClientId(expandedClientId === client.id ? null : client.id)}
 />
 ))
 )}
 </div>
 </div>
 );
}

function ClientCard({ client, isExpanded, onToggle }: { client: Client, isExpanded: boolean, onToggle: () => void }) {
 const { data: tasks = [], isLoading } = useQuery<Task[]>({
 queryKey: ["/api/clients", client.id, "tasks"],
 queryFn: async () => {
 return fetchJson(`/api/clients/${client.id}/tasks`);
 },
 enabled: isExpanded
 });

 return (
 <Card className="overflow-hidden">
 <CardHeader className="p-4 cursor-pointer hover:bg-naya-olive-06 :bg-naya-olive/50 transition-colors" onClick={onToggle}>
 <div className="flex items-start justify-between">
 <div className="space-y-1">
 <CardTitle className="text-base">{client.name}</CardTitle>
 <div className="flex items-center gap-2 text-xs text-naya-cream0">
 {client.contactName && <span>{client.contactName}</span>}
 {client.contactName && client.email && <span>•</span>}
 {client.email && <span>{client.email}</span>}
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-[10px] capitalize">{client.lifecycleStage}</Badge>
 <Badge className={`text-[10px] capitalize ${
 client.urgencyLevel === 'critical' ? 'bg-[rgba(158,126,135,0.12)]0' :
 client.urgencyLevel === 'high' ? 'bg-[rgba(212,201,122,0.12)]0' :
 client.urgencyLevel === 'medium' ? 'bg-[rgba(125,143,168,0.12)]0' : 'bg-naya-olive-060'
 }`}>
 {client.urgencyLevel}
 </Badge>
 </div>
 </div>
 </CardHeader>
 {isExpanded && (
 <CardContent className="p-4 pt-0 border-t bg-naya-olive-06/50 ">
 <div className="mt-4">
 <h4 className="text-xs text-naya-olive-35 uppercase tracking-wider mb-3">Client Tasks</h4>
 {isLoading ? (
 <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
 ) : tasks.length === 0 ? (
 <p className="text-xs text-naya-cream0 italic">No tasks specifically assigned to this client.</p>
 ) : (
 <div className="space-y-2">
 {tasks.map(task => (
 <div key={task.id} className="flex items-center gap-2 p-2 rounded bg-white border text-sm">
 {task.completed ? <CheckCircle2 className="h-4 w-4 text-naya-olive-55" /> : <Circle className="h-4 w-4 text-naya-olive-18" />}
 <span className={task.completed ? 'line-through text-naya-olive-35' : ''}>{task.title}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 </CardContent>
 )}
 </Card>
 );
}

function ProjectTasksPanel({ project }: { project: Project }) {
 const { t } = useTranslation();
 const queryClient = useQueryClient();
 const { toast } = useToast();
 const [isGenerating, setIsGenerating] = useState(false);

 const today = new Date().toISOString().split('T')[0];
 const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
 const upcoming = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

 const { data: todayTasks = [], isLoading: todayLoading } = useQuery<any[]>({
 queryKey: ['/api/tasks', { projectId: project.id, date: today }],
 queryFn: async () => {
 return fetchJson(`/api/tasks?projectId=${project.id}&date=${today}`);
 },
 });
 const { data: tomorrowTasks = [], isLoading: tomorrowLoading } = useQuery<any[]>({
 queryKey: ['/api/tasks', { projectId: project.id, date: tomorrow }],
 queryFn: async () => {
 return fetchJson(`/api/tasks?projectId=${project.id}&date=${tomorrow}`);
 },
 });
 const { data: upcomingTasks = [], isLoading: upcomingLoading } = useQuery<any[]>({
 queryKey: ['/api/tasks', { projectId: project.id, upcoming: upcoming }],
 queryFn: async () => {
 return fetchJson(`/api/tasks?projectId=${project.id}`);
 },
 });

 const toggleTaskMutation = useMutation({
 mutationFn: async (taskId: number) => {
 const res = await apiRequest("POST", `/api/tasks/${taskId}/toggle`);
 return res.json();
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
 },
 });

 const generateMutation = useMutation({
 mutationFn: async () => {
 setIsGenerating(true);
 const res = await apiRequest("POST", "/api/tasks/generate-daily", { projectId: project.id });
 return res.json();
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
 toast({ title: t('settings.saved') });
 },
 onError: () => {
 toast({ title: t('common.error'), variant: "destructive" });
 },
 onSettled: () => setIsGenerating(false),
 });

 function TaskList({ tasks, loading }: { tasks: any[]; loading: boolean }) {
 if (loading) return <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-naya-olive-35" /></div>;
 if (tasks.length === 0) return (
 <div className="py-6 text-center border-2 border-dashed border-naya-olive-18 rounded-lg">
 <p className="text-sm text-naya-olive-55">No tasks yet.</p>
 </div>
 );
 return (
 <div className="space-y-2">
 {tasks.map((task: any) => (
 <div
 key={task.id}
 className="flex items-start gap-2.5 p-2.5 rounded-lg border border-naya-olive-18"
 style={{ borderLeftWidth: 3, borderLeftColor: project.color || '#6366f1' }}
 >
 <button
 onClick={() => toggleTaskMutation.mutate(task.id)}
 disabled={toggleTaskMutation.isPending}
 className="mt-0.5 flex-shrink-0"
 >
 {task.completed
 ? <CheckCircle2 className="h-4 w-4 text-naya-olive-55" />
 : <Circle className="h-4 w-4 text-naya-olive-35" />}
 </button>
 <div className="flex-1 min-w-0">
 <p className={`text-sm text-foreground ${task.completed ? 'line-through opacity-60' : ''}`}>
 {task.title}
 </p>
 <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
 <span className="text-xs">{TYPE_ICONS[task.type] || '—'}</span>
 {task.category && (
 <Badge className={`${CATEGORY_COLORS[task.category] || 'bg-naya-olive-10 text-naya-olive-55'} text-[10px] h-3.5 border-0 px-1`}>
 {task.category}
 </Badge>
 )}
 {task.estimatedDuration && (
 <span className="text-[10px] text-naya-olive-35 flex items-center gap-0.5">
 <Clock className="h-2.5 w-2.5" />~{task.estimatedDuration}m
 </span>
 )}
 </div>
 </div>
 </div>
 ))}
 </div>
 );
 }

 return (
 <div>
 <div className="flex items-center justify-between mb-3">
 <h3 className="font-semibold text-foreground">{t('campaigns.tasks')}</h3>
 </div>
 <Tabs defaultValue="today">
 <TabsList className="h-7 text-xs mb-3">
 <TabsTrigger value="today" className="text-xs px-3 h-6">Today</TabsTrigger>
 <TabsTrigger value="tomorrow" className="text-xs px-3 h-6">Tomorrow</TabsTrigger>
 <TabsTrigger value="upcoming" className="text-xs px-3 h-6">Upcoming</TabsTrigger>
 </TabsList>
 <TabsContent value="today"><TaskList tasks={todayTasks} loading={todayLoading} /></TabsContent>
 <TabsContent value="tomorrow"><TaskList tasks={tomorrowTasks} loading={tomorrowLoading} /></TabsContent>
 <TabsContent value="upcoming"><TaskList tasks={upcomingTasks.filter((task: any) => !task.completed)} loading={upcomingLoading} /></TabsContent>
 </Tabs>
 </div>
 );
}

// ─── Project Card Component ────────────────────────────────────────────────
function ProjectCard({ project, onOpenTab }: { project: Project; onOpenTab: (project: Project, tab: string) => void }) {
 const { t } = useTranslation();

 // Check if Brand DNA is configured for this project
 const { data: brandDna } = useQuery<any>({
 queryKey: ['/api/projects', project.id, 'brand-dna'],
 queryFn: () => fetchJson(`/api/projects/${project.id}/brand-dna`),
 });

 const hasProjectSpecificDna = brandDna?.projectId === project.id;
 const monetInfo = MONETIZATION_LABELS[project.monetizationIntent || 'exploratory'];

 return (
 <Card className="hover:shadow-rest transition-shadow border-naya-olive-18 overflow-hidden">
 <CardContent className="p-5">
 <div className="flex items-start justify-between mb-3">
 <div className="flex items-center gap-2">
 <div
 className="w-3 h-3 rounded-full flex-shrink-0"
 style={{ backgroundColor: project.color || '#6366f1' }}
 />
 <span className="text-xl">{project.icon || '◇'}</span>
 </div>
 <div className="flex items-center gap-1 flex-wrap justify-end">
 {project.isPrimary && (
 <Badge className="text-[10px] h-5 bg-primary/10 text-primary border-0">Primary</Badge>
 )}
 <Badge variant="outline" className="text-[10px] h-5">
 {project.type}
 </Badge>
 {!hasProjectSpecificDna && (
 <Badge
 className="text-[10px] h-5 bg-[hsl(150,20%,55%)]/10 text-[hsl(150,20%,45%)] ,20%,55%)]/20 ,20%,60%)] border-0 cursor-pointer hover:bg-[hsl(150,20%,55%)]/20"
 onClick={(e) => {
 e.stopPropagation();
 onOpenTab(project, "brand-dna");
 }}
 >
 <Dna className="h-2.5 w-2.5 mr-0.5" />
 Setup
 </Badge>
 )}
 </div>
 </div>

 <div
 className="cursor-pointer"
 onClick={() => onOpenTab(project, "tasks")}
 >
 <h3 className="font-semibold text-foreground mb-1">{project.name}</h3>
 {project.description && (
 <p className="text-xs text-naya-olive-55 line-clamp-2 mb-3">{project.description}</p>
 )}

 <div className="flex items-center gap-2 mt-3">
 <span className={`text-[10px] px-2 py-0.5 rounded-full ${monetInfo?.color || ''}`}>
 {monetInfo?.label || project.monetizationIntent}
 </span>
 <span className={`text-[10px] px-2 py-0.5 rounded-full ${
 project.projectStatus === 'active' ? 'bg-naya-olive-10 text-naya-olive ' :
 project.projectStatus === 'paused' ? 'bg-[rgba(212,201,122,0.20)] text-[#5a4f0d]' :
 'bg-naya-olive-10 text-naya-olive-55'
 }`}>
 {project.projectStatus}
 </span>
 </div>
 </div>

 {!hasProjectSpecificDna && (
 <div className="mt-3 pt-3 border-t border-naya-olive-10 ">
 <button
 onClick={(e) => {
 e.stopPropagation();
 onOpenTab(project, "brand-dna");
 }}
 className="w-full text-xs text-[hsl(150,20%,45%)] ,20%,60%)] hover:text-[hsl(150,20%,35%)] :text-[hsl(150,20%,70%)] transition-colors flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-[hsl(150,20%,55%)]/5"
 >
 <Dna className="h-3.5 w-3.5" />
 <span>Configure Brand DNA for targeted planning</span>
 </button>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

// ─── Brand DNA per-project tab (full editor) ─────────────────────
function BrandDnaProjectTab({ project }: { project: Project }) {
  return (
    <div className="pb-4">
      <BrandDnaEditor projectId={project.id} projectName={project.name} />
    </div>
  );
}

interface ProjectsProps {
 onSearchClick?: () => void;
}

function invalidateAllProjects(queryClient: ReturnType<typeof useQueryClient>) {
 queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
 queryClient.invalidateQueries({ queryKey: ['/api/projects?limit=200'] });
}

// ─── Roadmap Jalons ──────────────────────────────────────────────────────────
// Extrait dans client/src/pages/project/MilestoneRoadmap.tsx (Task 7) — importé ci-dessus,
// partagé avec ProjectPage.

export default function Projects({ onSearchClick }: ProjectsProps) {
 const { t } = useTranslation();
 const queryClient = useQueryClient();
 const { toast } = useToast();
 const { setActiveProjectId } = useProject();
 const [createOpen, setCreateOpen] = useState(false);
 const [selectedProject, setSelectedProject] = useState<Project | null>(null);
 const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0]);
 const [addGoalOpen, setAddGoalOpen] = useState(false);
 const [initialTab, setInitialTab] = useState<string>("tasks");

 const [projectPages, setProjectPages] = useState(1);
 const PAGE_SIZE = 50;

 const { data: projects = [], isLoading } = useQuery<Project[]>({
 queryKey: ['/api/projects', projectPages],
 queryFn: async () => {
 const allResults: Project[] = [];
 for (let page = 0; page < projectPages; page++) {
 const batch = await fetchJson<Project[]>(`/api/projects?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
 allResults.push(...batch);
 if (batch.length < PAGE_SIZE) break;
 }
 return allResults;
 },
 });

 const { data: projectDetail } = useQuery<Project & { goals: ProjectGoal[] }>({
 queryKey: ['/api/projects', selectedProject?.id],
 enabled: !!selectedProject,
 });

 const createProjectMutation = useMutation({
 mutationFn: (data: z.infer<typeof createProjectSchema>) =>
 apiRequest('POST', '/api/projects', { ...data, color: selectedColor }),
 onSuccess: () => {
 invalidateAllProjects(queryClient);
 setCreateOpen(false);
 createForm.reset();
 toast({ title: t('projects.projectCreated') });
 },
 onError: () => toast({ title: t('common.error'), variant: "destructive" }),
 });

 const setPrimaryMutation = useMutation({
 mutationFn: (projectId: number) => apiRequest('POST', `/api/projects/${projectId}/set-primary`, {}),
 onSuccess: (_, projectId) => {
 invalidateAllProjects(queryClient);
 queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
 setActiveProjectId(projectId);
 toast({ title: t('projects.projectUpdated') });
 },
 });

 const deleteProjectMutation = useMutation({
 mutationFn: (projectId: number) => apiRequest('DELETE', `/api/projects/${projectId}`),
 onSuccess: () => {
 invalidateAllProjects(queryClient);
 setSelectedProject(null);
 toast({ title: t('common.delete') });
 },
 });

 const createGoalMutation = useMutation({
 mutationFn: async (data: z.infer<typeof createGoalSchema> & { projectId: number }) => {
 const { projectId, ...rest } = data;
 const cleaned = Object.fromEntries(
 Object.entries(rest).map(([k, v]) => [k, v === '' ? undefined : v])
 );
 const res = await apiRequest('POST', `/api/projects/${projectId}/goals`, cleaned);
 return res.json();
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['/api/projects', selectedProject?.id] });
 invalidateAllProjects(queryClient);
 setAddGoalOpen(false);
 goalForm.reset();
 toast({ title: t('projects.goalCreated') });
 },
 onError: () => toast({ title: t('common.error'), variant: "destructive" }),
 });

 const updateGoalMutation = useMutation({
 mutationFn: ({ id, projectId, status }: { id: number; projectId: number; status: string }) =>
 apiRequest('PATCH', `/api/projects/${projectId}/goals/${id}`, { status }),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/projects', selectedProject?.id] }),
 });

 const generateTasksMutation = useMutation({
 mutationFn: (goalId: number) =>
 apiRequest('POST', `/api/goals/${goalId}/generate-tasks`).then(r => r.json()),
 onSuccess: (data: any) => {
 queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
 toast({ title: t('projects.tasksGenerated'), description: t('projects.tasksGeneratedDesc') });
 },
 onError: () => toast({ title: t('projects.generateError'), variant: "destructive" }),
 });

 const createForm = useForm<z.infer<typeof createProjectSchema>>({
 resolver: zodResolver(createProjectSchema),
 defaultValues: {
 name: "",
 type: "Business",
 description: "",
 monetizationIntent: "exploratory",
 priorityLevel: "secondary",
 category: "",
 dailyTimeBudgetHours: undefined,
 icon: "◇",
 color: "#6366f1",
 projectKind: "personal",
 clientName: "",
 clientContact: "",
 clientBrief: "",
 },
 });

 const goalForm = useForm<z.infer<typeof createGoalSchema>>({
 resolver: zodResolver(createGoalSchema),
 defaultValues: {
 title: "",
 description: "",
 goalType: "monthly",
 successMode: "visibility",
 targetValue: "",
 timeframe: "",
 },
 });

 const onCreateProject = (data: z.infer<typeof createProjectSchema>) => {
 // kind='personal' : les champs client sont non pertinents → non envoyés (restent null en base).
 const payload = data.projectKind === "client"
 ? data
 : { ...data, clientName: undefined, clientContact: undefined, clientBrief: undefined };
 createProjectMutation.mutate(payload);
 };

 const onCreateGoal = (data: z.infer<typeof createGoalSchema>) => {
 if (!selectedProject) return;
 createGoalMutation.mutate({ ...data, projectId: selectedProject.id });
 };

 const openProjectTab = (project: Project, tab: string = "tasks") => {
 setSelectedProject(project);
 setInitialTab(tab);
 };

 const goals = (projectDetail as any)?.goals as ProjectGoal[] | undefined;
 const activeGoals = goals?.filter(g => g.status === 'active') || [];
 const completedGoals = goals?.filter(g => g.status === 'completed') || [];

 return (
 <div className="flex h-screen bg-background">
 <Sidebar onSearchClick={onSearchClick} />

 <div className="flex-1 flex flex-col overflow-hidden">
 <header className="bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
 <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('projects.title')}</h1>
 <p className="text-sm text-muted-foreground mt-1">{t('projects.subtitle')}</p>
 </div>
 <Dialog open={createOpen} onOpenChange={setCreateOpen}>
 <DialogTrigger asChild>
 <Button className="gap-2">
 <Plus className="h-4 w-4" />
 {t('projects.createProject')}
 </Button>
 </DialogTrigger>
 <DialogContent className="sm:max-w-lg">
 <DialogHeader>
 <DialogTitle>{t('projects.createProject')}</DialogTitle>
 </DialogHeader>
 <Form {...createForm}>
 <form onSubmit={createForm.handleSubmit(onCreateProject)} className="space-y-4">
 <FormField
 control={createForm.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.projectName')}</FormLabel>
 <FormControl>
 <Input placeholder="e.g. My Agency, Personal Brand, Passion Project" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 {/* Nature du projet : perso vs client (champs client conditionnels). */}
 <FormField
 control={createForm.control}
 name="projectKind"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Nature du projet</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="personal">🙂 Projet personnel</SelectItem>
 <SelectItem value="client">💼 Projet client</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />

 {createForm.watch("projectKind") === "client" && (
 <div className="space-y-3 rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-3">
 <FormField
 control={createForm.control}
 name="clientName"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Nom du client</FormLabel>
 <FormControl><Input placeholder="Ex : Acme SARL" {...field} /></FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={createForm.control}
 name="clientContact"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Contact client <span className="text-naya-olive-35">(optionnel)</span></FormLabel>
 <FormControl><Input placeholder="Nom · email · téléphone" {...field} /></FormControl>
 </FormItem>
 )}
 />
 <FormField
 control={createForm.control}
 name="clientBrief"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Brief client <span className="text-naya-olive-35">(optionnel)</span></FormLabel>
 <FormControl><Textarea placeholder="Contexte, objectifs, contraintes…" rows={2} {...field} /></FormControl>
 </FormItem>
 )}
 />
 </div>
 )}

 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={createForm.control}
 name="type"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.projectType')}</FormLabel>
 <Select onValueChange={(v) => {
 field.onChange(v);
 createForm.setValue('icon', PROJECT_TYPE_ICONS[v] || '◇');
 }} defaultValue={field.value}>
 <FormControl>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 {Object.entries(PROJECT_TYPE_ICONS).map(([type, icon]) => (
 <SelectItem key={type} value={type}>{icon} {type}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={createForm.control}
 name="monetizationIntent"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.monetizationIntent')}</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="revenue-now">Revenue Now</SelectItem>
 <SelectItem value="authority-building">Authority Building</SelectItem>
 <SelectItem value="exploratory">Exploratory</SelectItem>
 <SelectItem value="none">Non-commercial</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>

 <div className="grid grid-cols-3 gap-3">
 <FormField
 control={createForm.control}
 name="category"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Catégorie</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
 <FormControl><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="revenue">Revenu</SelectItem>
 <SelectItem value="passion">Passion</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={createForm.control}
 name="dailyTimeBudgetHours"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Heures/jour</FormLabel>
 <FormControl>
 <Input type="number" min={0} max={16} placeholder="ex : 4"
 value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={createForm.control}
 name="priorityLevel"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Priorité</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="primary">Principale</SelectItem>
 <SelectItem value="secondary">Secondaire</SelectItem>
 <SelectItem value="background">En fond</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>

 <FormField
 control={createForm.control}
 name="description"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.description')} ({t('common.optional')})</FormLabel>
 <FormControl>
 <Textarea placeholder="What is this project about?" rows={2} {...field} />
 </FormControl>
 </FormItem>
 )}
 />

 {/* Color picker */}
 <div>
 <p className="text-sm text-naya-olive-70 mb-2">{t('projects.color')}</p>
 <div className="flex gap-2 flex-wrap">
 {PROJECT_COLORS.map(color => (
 <button
 key={color}
 type="button"
 onClick={() => setSelectedColor(color)}
 className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${selectedColor === color ? 'border-slate-900 scale-110' : 'border-transparent'}`}
 style={{ backgroundColor: color }}
 />
 ))}
 </div>
 </div>

 <div className="flex justify-end gap-3 pt-2">
 <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
 {t('common.cancel')}
 </Button>
 <Button type="submit" disabled={createProjectMutation.isPending}>
 {createProjectMutation.isPending ? t('common.loading') : t('projects.createProject')}
 </Button>
 </div>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </div>
 </header>
 <main className="flex-1 overflow-y-auto">
 <div className="p-8">

 {isLoading ? (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {[1,2,3].map(i => (
 <div key={i} className="h-40 bg-naya-olive-18 rounded-lg animate-pulse" />
 ))}
 </div>
 ) : projects.length === 0 ? (
 <div className="text-center py-20">
 <div className="text-5xl mb-4 text-naya-olive-18 font-display">◇</div>
 <h3 className="text-lg text-foreground mb-2">{t('projects.noProjects')}</h3>
 <p className="text-naya-olive-55 mb-6 max-w-sm mx-auto">
 {t('projects.noProjectsDescription')}
 </p>
 <Button onClick={() => setCreateOpen(true)} className="gap-2">
 <Plus className="h-4 w-4" />
 {t('projects.createProject')}
 </Button>
 </div>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {projects.map((project) => (
 <ProjectCard key={project.id} project={project} onOpenTab={openProjectTab} />
 ))}
 </div>
 )}
 {projects.length >= projectPages * PAGE_SIZE && (
 <div className="flex justify-center mt-4">
 <Button variant="outline" size="sm" onClick={() => setProjectPages(prev => prev + 1)}>
 {t('common.more')}
 </Button>
 </div>
 )}
 </div>
 </main>
 </div>

 {/* Project Detail Sheet */}
 <Sheet open={!!selectedProject} onOpenChange={(open) => !open && setSelectedProject(null)}>
 <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
 {selectedProject && (
 <>
 <SheetHeader className="mb-6">
 <div className="flex items-center gap-3">
 <div
 className="w-4 h-4 rounded-full"
 style={{ backgroundColor: selectedProject.color || '#6366f1' }}
 />
 <span className="text-2xl">{selectedProject.icon || '◇'}</span>
 <SheetTitle>{selectedProject.name}</SheetTitle>
 </div>
 <div className="flex gap-2 mt-2 flex-wrap">
 <Badge variant="outline">{selectedProject.type}</Badge>
 <Badge className={`border-0 ${MONETIZATION_LABELS[selectedProject.monetizationIntent || 'exploratory']?.color}`}>
 {MONETIZATION_LABELS[selectedProject.monetizationIntent || 'exploratory']?.label}
 </Badge>
 </div>
 </SheetHeader>

 {selectedProject.description && (
 <p className="text-sm text-naya-olive-55 mb-6">{selectedProject.description}</p>
 )}

 {/* Actions */}
 <div className="flex gap-2 mb-6 flex-wrap">
 {!selectedProject.isPrimary && (
 <Button
 size="sm"
 variant="outline"
 onClick={() => setPrimaryMutation.mutate(selectedProject.id)}
 disabled={setPrimaryMutation.isPending}
 className="gap-1"
 >
 <Star className="h-3.5 w-3.5" />
 {t('common.primary')}
 </Button>
 )}
 <Button
 size="sm"
 variant="outline"
 onClick={() => setActiveProjectId(selectedProject.id)}
 className="gap-1"
 >
 <Target className="h-3.5 w-3.5" />
 {t('campaigns.active')}
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="gap-1 text-naya-mauve hover:text-[#5c3d45]"
 onClick={() => deleteProjectMutation.mutate(selectedProject.id)}
 disabled={deleteProjectMutation.isPending}
 >
 <Archive className="h-3.5 w-3.5" />
 {t('common.remove')}
 </Button>
 </div>

 <Separator className="mb-6" />

 <Tabs value={initialTab} onValueChange={setInitialTab} className="w-full">
 <TabsList className="mb-4">
 <TabsTrigger value="tasks">{t('campaigns.tasks')}</TabsTrigger>
 <TabsTrigger value="goals">{t('projects.goals')}</TabsTrigger>
 <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
 <TabsTrigger value="brand-dna">{t('projects.brandDna')}</TabsTrigger>
 {(selectedProject?.type?.toLowerCase().includes("agency") ||
 selectedProject?.type?.toLowerCase().includes("client")) && (
 <TabsTrigger value="clients">{t('projects.clients')}</TabsTrigger>
 )}
 </TabsList>

 <TabsContent value="tasks" className="mt-0">
 <ProjectTasksPanel project={selectedProject} />
 </TabsContent>

 <TabsContent value="goals" className="mt-0">
 {/* Goals Section */}
 <div className="mb-6">
 <div className="flex items-center justify-between mb-4">
 <h3 className="font-semibold text-foreground">{t('projects.goals')}</h3>
 <Button size="sm" variant="outline" onClick={() => setAddGoalOpen(true)} className="gap-1">
 <Plus className="h-3.5 w-3.5" />
 {t('projects.addGoal')}
 </Button>
 </div>

 {goals === undefined ? (
 <div className="space-y-2">
 {[1,2].map(i => <div key={i} className="h-14 bg-naya-olive-10 rounded animate-pulse" />)}
 </div>
 ) : activeGoals.length === 0 && completedGoals.length === 0 ? (
 <div className="text-center py-6 border-2 border-dashed border-naya-olive-18 rounded-lg">
 <p className="text-sm text-naya-olive-55">No goals yet.</p>
 <p className="text-xs text-naya-olive-35 mt-1">Add a goal to give Naya direction for this project.</p>
 </div>
 ) : (
 <div className="space-y-3">
 {activeGoals.map((goal) => (
 <div key={goal.id} className="p-3 bg-naya-olive-06 rounded-lg space-y-2">
 <div className="flex items-start gap-3">
 <button
 onClick={() => updateGoalMutation.mutate({ id: goal.id, projectId: selectedProject.id, status: 'completed' })}
 className="mt-0.5 text-naya-olive-35 hover:text-naya-olive-55 transition-colors flex-shrink-0"
 >
 <Circle className="h-4 w-4" />
 </button>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground">{goal.title}</p>
 <div className="flex items-center gap-2 mt-1">
 <span className="text-xs text-naya-olive-55">
 {SUCCESS_MODE_LABELS[goal.successMode] || goal.successMode}
 </span>
 {goal.dueDate && (
 <span className="text-xs text-naya-olive-35 ">
 · {new Date(goal.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
 </span>
 )}
 </div>
 {goal.targetValue && goal.currentValue && (
 <div className="mt-2">
 <Progress
 value={Math.min(100, (parseFloat(goal.currentValue) / parseFloat(goal.targetValue)) * 100)}
 className="h-1.5"
 />
 <p className="text-xs text-naya-olive-35 mt-0.5">
 {goal.currentValue} / {goal.targetValue}
 </p>
 </div>
 )}
 </div>
 </div>
 {/* Bouton Générer le plan */}
 <div className="flex justify-end">
 <Button
 size="sm"
 variant="outline"
 className="gap-1.5 h-7 text-xs border-naya-olive-18 text-[#354963] hover:bg-naya-olive-06 :bg-indigo-900/30"
 onClick={() => generateTasksMutation.mutate(goal.id)}
 disabled={generateTasksMutation.isPending}
 >
 {generateTasksMutation.isPending ? (
 <Loader2 className="h-3 w-3 animate-spin" />
 ) : (
 <Sparkles className="h-3 w-3" />
 )}
 {t('projects.generatePlan')}
 </Button>
 </div>
 </div>
 ))}

 {completedGoals.length > 0 && (
 <details className="mt-2">
 <summary className="text-xs text-naya-olive-35 cursor-pointer hover:text-naya-olive-55">
 {completedGoals.length} completed
 </summary>
 <div className="space-y-2 mt-2">
 {completedGoals.map((goal) => (
 <div key={goal.id} className="flex items-center gap-3 p-2 opacity-60">
 <CheckCircle2 className="h-4 w-4 text-naya-olive-55 flex-shrink-0" />
 <p className="text-sm text-naya-olive-70 line-through">{goal.title}</p>
 </div>
 ))}
 </div>
 </details>
 )}
 </div>
 )}
 </div>
 </TabsContent>

 <TabsContent value="roadmap" className="mt-0">
 <MilestoneRoadmap project={selectedProject} />
 </TabsContent>

 <TabsContent value="brand-dna" className="mt-0">
 <BrandDnaProjectTab project={selectedProject} />
 </TabsContent>

 {(selectedProject?.type?.toLowerCase().includes("agency") || 
 selectedProject?.type?.toLowerCase().includes("client")) && (
 <TabsContent value="clients" className="mt-0">
 <ClientsTab project={selectedProject} />
 </TabsContent>
 )}
 </Tabs>

 <Separator className="mb-6 mt-2" />

 {/* Tasks Section */}
 <ProjectTasksPanel project={selectedProject} />

 <Separator className="mb-6 mt-6" />

 {/* Add Goal Dialog */}
 <Dialog open={addGoalOpen} onOpenChange={setAddGoalOpen}>
 <DialogContent>
 <DialogHeader>
 <DialogTitle>{t('projects.addGoal')}</DialogTitle>
 </DialogHeader>
 <Form {...goalForm}>
 <form onSubmit={goalForm.handleSubmit(onCreateGoal)} className="space-y-4">
 <FormField
 control={goalForm.control}
 name="title"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.goalTitle')}</FormLabel>
 <FormControl>
 <Input placeholder="e.g. Sign 2 clients this month" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={goalForm.control}
 name="goalType"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.goalType')}</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="monthly">Monthly</SelectItem>
 <SelectItem value="quarterly">Quarterly</SelectItem>
 <SelectItem value="milestone">Milestone</SelectItem>
 <SelectItem value="revenue">Revenue</SelectItem>
 <SelectItem value="visibility">Visibility</SelectItem>
 <SelectItem value="consistency">Consistency</SelectItem>
 </SelectContent>
 </Select>
 </FormItem>
 )}
 />

 <FormField
 control={goalForm.control}
 name="successMode"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.successMode')}</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
 <SelectContent>
 <SelectItem value="revenue">◆ Revenue</SelectItem>
 <SelectItem value="visibility">◇ Visibility</SelectItem>
 <SelectItem value="consistency">▶ Consistency</SelectItem>
 <SelectItem value="exploration">▷ Exploration</SelectItem>
 <SelectItem value="learning">— Learning</SelectItem>
 <SelectItem value="wellbeing">◯ Wellbeing</SelectItem>
 </SelectContent>
 </Select>
 </FormItem>
 )}
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={goalForm.control}
 name="targetValue"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.targetValue')} ({t('common.optional')})</FormLabel>
 <FormControl>
 <Input placeholder="e.g. 2 clients, 10k" {...field} />
 </FormControl>
 </FormItem>
 )}
 />
 <FormField
 control={goalForm.control}
 name="dueDate"
 render={({ field }) => (
 <FormItem>
 <FormLabel>{t('projects.dueDate')} ({t('common.optional')})</FormLabel>
 <FormControl>
 <Input type="date" {...field} />
 </FormControl>
 </FormItem>
 )}
 />
 </div>

 <div className="flex justify-end gap-3">
 <Button type="button" variant="outline" onClick={() => setAddGoalOpen(false)}>{t('common.cancel')}</Button>
 <Button type="submit" disabled={createGoalMutation.isPending}>
 {createGoalMutation.isPending ? t('common.loading') : t('projects.addGoal')}
 </Button>
 </div>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </>
 )}
 </SheetContent>
 </Sheet>
 </div>
 );
}
