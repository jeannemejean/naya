import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Rocket, Plus, Loader2, CheckCircle2, Pause, Trash2, Edit2, X,
  Clock, Zap, Brain, Users, Settings, Lightbulb, Target,
  ChevronUp, ChevronDown, AlertTriangle, CalendarDays, RotateCcw
} from "lucide-react";
import type { Project, Task } from "@shared/schema";
import { formatLocalDate } from "@/lib/dateUtils";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";

interface CampaignPhase {
  number: number;
  name: string;
  duration: string;
  objective: string;
  keyActions: string[];
  successSignal: string;
}

interface ChannelConfig {
  platform: string;
  role: string;
  frequency: string;
  contentFormat: string[];
  tone: string;
}

interface ContentPiece {
  phase: number;
  week: string;
  platform: string;
  format: string;
  angle: string;
  pillar: string;
  goal: string;
  copyDirections: string;
}

interface MessagingFramework {
  coreMessage: string;
  proofPoints: string[];
  primaryCTA: string;
  secondaryCTA: string;
  toneKeywords: string[];
  thingsToAvoid: string[];
}

interface CampaignKPI {
  metric: string;
  target: string;
  howToMeasure: string;
  phase: number;
}

interface Campaign {
  id: number;
  userId: string;
  projectId: number | null;
  name: string;
  objective: string;
  coreMessage: string | null;
  targetAudience: string | null;
  duration: string | null;
  status: string | null;
  tasksGenerated: boolean | null;
  generatedTasks: GeneratedTask[] | null;
  insights: string[] | null;
  campaignType: string | null;
  phases: CampaignPhase[] | null;
  messagingFramework: MessagingFramework | null;
  channels: ChannelConfig[] | null;
  contentPlan: ContentPiece[] | null;
  kpis: CampaignKPI[] | null;
  audienceSegment: string | null;
  pauseNote: string | null;
  reviewContentQuality: number | null;
  reviewAudienceResponse: number | null;
  reviewTaskExecution: number | null;
  reviewedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface GeneratedTask {
  title: string;
  description: string;
  type: string;
  category: string;
  priority: number;
  estimatedDuration: number;
  taskEnergyType: string;
  phase?: number;
}

interface GenerateResponse {
  campaign: Campaign;
  generated: {
    name: string;
    campaignType: string;
    coreMessage: string;
    targetAudience: string;
    audienceSegment: string;
    insights: string[];
    messagingFramework: MessagingFramework;
    phases: CampaignPhase[];
    channels: ChannelConfig[];
    contentPlan: ContentPiece[];
    kpis: CampaignKPI[];
    tasks: GeneratedTask[];
  };
}

type RightPanelState = "empty" | "creating" | "generated" | "detail";

const STATUS_BADGES: Record<string, { variant: "outline" | "default" | "secondary" | "destructive"; labelKey: string }> = {
  draft: { variant: "outline", labelKey: "campaigns.draft" },
  active: { variant: "default", labelKey: "campaigns.active" },
  completed: { variant: "secondary", labelKey: "campaigns.completed" },
  paused: { variant: "outline", labelKey: "campaigns.paused" },
};

const TYPE_COLORS: Record<string, string> = {
  content: "bg-purple-100 text-purple-700",
  outreach: "bg-blue-100 text-blue-700",
  admin: "bg-gray-100 text-gray-700",
  planning: "bg-amber-100 text-amber-700",
};

const ENERGY_ICONS: Record<string, typeof Brain> = {
  deep_work: Brain,
  creative: Lightbulb,
  admin: Settings,
  social: Users,
  execution: Zap,
};

const INSIGHT_COLORS = ["bg-indigo-400", "bg-violet-400", "bg-cyan-400", "bg-emerald-400"];

const DURATION_OPTIONS = [
  { value: "1_week", labelKey: "campaigns.duration1Week" },
  { value: "2_weeks", labelKey: "campaigns.duration2Weeks" },
  { value: "3_weeks", labelKey: "campaigns.duration3Weeks" },
  { value: "1_month", labelKey: "campaigns.duration1Month" },
  { value: "2_months", labelKey: "campaigns.duration2Months" },
  { value: "3_months", labelKey: "campaigns.duration3Months" },
  { value: "6_months", labelKey: "campaigns.duration6Months" },
  { value: "12_months", labelKey: "campaigns.duration12Months" },
];

const UNDER_3_MONTHS = new Set(["1_week", "2_weeks", "3_weeks", "1_month", "2_months"]);
const UNDER_2_MONTHS = new Set(["1_week", "2_weeks", "3_weeks", "1_month"]);

function getDurationWarning(objective: string, duration: string): string | null {
  const objLower = objective.toLowerCase();
  if (objLower.includes("authority") && UNDER_3_MONTHS.has(duration)) {
    return "Authority building campaigns typically need at least 3 months for sustainable results.";
  }
  if (objLower.includes("lead gen") && UNDER_2_MONTHS.has(duration)) {
    return "Lead generation campaigns typically need at least 2 months for sustainable pipeline building.";
  }
  return null;
}

function CollapsibleSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left mb-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 flex-1">{title}</p>
        {open ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}
      </button>
      {open && children}
    </div>
  );
}

function CampaignArchitectureSections({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  return (
    <>
      {campaign.phases && (campaign.phases as CampaignPhase[]).length > 0 && (
        <CollapsibleSection title={`${t('campaigns.phases')} (${(campaign.phases as CampaignPhase[]).length})`}>
          <div className="space-y-3">
            {(campaign.phases as CampaignPhase[]).map((phase, i) => (
              <Card key={i} className="dark:bg-gray-900 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-900 dark:text-white">
                      {t('campaigns.phase')} {phase.number}: {phase.name}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-gray-500">{phase.duration}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-gray-400 mb-2">{phase.objective}</p>
                  {phase.keyActions && phase.keyActions.length > 0 && (
                    <ul className="space-y-1 mb-2">
                      {phase.keyActions.map((action, j) => (
                        <li key={j} className="text-xs text-slate-500 dark:text-gray-400 flex items-start gap-1.5">
                          <span className="text-slate-300 dark:text-gray-600 mt-0.5">•</span>
                          {action}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>{phase.successSignal}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {campaign.messagingFramework && (
        <CollapsibleSection title={t('campaigns.messagingFramework')}>
          {(() => {
            const mf = campaign.messagingFramework as MessagingFramework;
            return (
              <Card className="dark:bg-gray-900 dark:border-gray-700">
                <CardContent className="p-3 space-y-3">
                  <div>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase mb-0.5">{t('campaigns.coreMessage')}</p>
                    <p className="text-sm text-slate-800 dark:text-gray-200">{mf.coreMessage}</p>
                  </div>
                  {mf.proofPoints && mf.proofPoints.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase mb-0.5">{t('campaigns.proofPoints')}</p>
                      <ul className="space-y-0.5">
                        {mf.proofPoints.map((pp, i) => (
                          <li key={i} className="text-xs text-slate-600 dark:text-gray-400 flex items-start gap-1.5">
                            <span className="text-slate-300 dark:text-gray-600 mt-0.5">•</span>{pp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase mb-0.5">{t('campaigns.primaryCTA')}</p>
                      <p className="text-xs text-slate-700 dark:text-gray-300">{mf.primaryCTA}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase mb-0.5">{t('campaigns.secondaryCTA')}</p>
                      <p className="text-xs text-slate-700 dark:text-gray-300">{mf.secondaryCTA}</p>
                    </div>
                  </div>
                  {mf.toneKeywords && mf.toneKeywords.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase mb-0.5">{t('campaigns.tone')}</p>
                      <div className="flex flex-wrap gap-1">
                        {mf.toneKeywords.map((kw, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 text-[10px]">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {mf.thingsToAvoid && mf.thingsToAvoid.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase mb-0.5">{t('campaigns.avoid')}</p>
                      <div className="flex flex-wrap gap-1">
                        {mf.thingsToAvoid.map((item, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-[10px]">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </CollapsibleSection>
      )}

      {campaign.channels && (campaign.channels as ChannelConfig[]).length > 0 && (
        <CollapsibleSection title={t('campaigns.channelStrategy')}>
          <div className="grid grid-cols-2 gap-2">
            {(campaign.channels as ChannelConfig[]).map((ch, i) => (
              <div key={i} className="border border-slate-200 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-900 dark:text-white capitalize">{ch.platform}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${ch.role === 'Primary' ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-gray-800 text-slate-500'}`}>{ch.role}</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-gray-400">{ch.frequency} · {ch.contentFormat?.join(', ')}</p>
                {ch.tone && <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1 italic">{ch.tone}</p>}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {campaign.contentPlan && (campaign.contentPlan as ContentPiece[]).length > 0 && (
        <CollapsibleSection title={t('campaigns.contentPlan')} defaultOpen={false}>
          {(() => {
            const pieces = campaign.contentPlan as ContentPiece[];
            const byPhase = pieces.reduce((acc, p) => {
              const key = p.phase || 1;
              (acc[key] = acc[key] || []).push(p);
              return acc;
            }, {} as Record<number, ContentPiece[]>);
            return (
              <div className="space-y-3">
                {Object.entries(byPhase).sort(([a], [b]) => Number(a) - Number(b)).map(([phaseNum, items]) => (
                  <div key={phaseNum}>
                    <p className="text-[10px] text-slate-500 dark:text-gray-400 mb-1">{t('campaigns.phase')} {phaseNum}</p>
                    <div className="space-y-1.5">
                      {items.map((cp, j) => (
                        <div key={j} className="border border-slate-100 dark:border-gray-800 rounded-lg p-2.5 bg-white dark:bg-gray-900">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400">{cp.week}</span>
                            <span className="text-[10px] text-slate-400 capitalize">{cp.platform}</span>
                            <span className="text-[10px] text-slate-400">·</span>
                            <span className="text-[10px] text-slate-400 capitalize">{cp.format}</span>
                          </div>
                          <p className="text-xs text-slate-800 dark:text-gray-200">{cp.angle}</p>
                          {cp.copyDirections && <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1 italic">{cp.copyDirections}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </CollapsibleSection>
      )}

      {campaign.kpis && (campaign.kpis as CampaignKPI[]).length > 0 && (
        <CollapsibleSection title={t('campaigns.kpis')} defaultOpen={false}>
          {(() => {
            const kpis = campaign.kpis as CampaignKPI[];
            const byPhase = kpis.reduce((acc, k) => {
              const key = k.phase || 1;
              (acc[key] = acc[key] || []).push(k);
              return acc;
            }, {} as Record<number, CampaignKPI[]>);
            return (
              <div className="space-y-3">
                {Object.entries(byPhase).sort(([a], [b]) => Number(a) - Number(b)).map(([phaseNum, items]) => (
                  <div key={phaseNum}>
                    <p className="text-[10px] text-slate-500 dark:text-gray-400 mb-1">{t('campaigns.phase')} {phaseNum}</p>
                    <div className="border border-slate-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <div className="grid grid-cols-3 gap-0 bg-slate-50 dark:bg-gray-800 px-3 py-1.5 text-[10px] text-slate-500 dark:text-gray-400 uppercase">
                        <span>{t('campaigns.metric')}</span>
                        <span>{t('campaigns.target')}</span>
                        <span>{t('campaigns.howToMeasure')}</span>
                      </div>
                      {items.map((kpi, i) => (
                        <div key={i} className="grid grid-cols-3 gap-0 px-3 py-2 border-t border-slate-100 dark:border-gray-800 text-xs">
                          <span className="text-slate-700 dark:text-gray-300">{kpi.metric}</span>
                          <span className="text-slate-600 dark:text-gray-400">{kpi.target}</span>
                          <span className="text-slate-500 dark:text-gray-500">{kpi.howToMeasure}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </CollapsibleSection>
      )}
    </>
  );
}

function TasksByPhase({ tasks, editingTaskIdx, editTaskTitle, setEditingTaskIdx, setEditTaskTitle, handleSaveTaskTitle }: {
  tasks: GeneratedTask[];
  editingTaskIdx: number | null;
  editTaskTitle: string;
  setEditingTaskIdx: (idx: number | null) => void;
  setEditTaskTitle: (v: string) => void;
  handleSaveTaskTitle: (idx: number) => void;
}) {
  const { t: translate } = useTranslation();
  const hasPhases = tasks.some(t => t.phase !== undefined);
  const grouped = hasPhases
    ? tasks.reduce((acc, t, i) => {
        const key = t.phase || 0;
        (acc[key] = acc[key] || []).push({ task: t, originalIdx: i });
        return acc;
      }, {} as Record<number, Array<{ task: GeneratedTask; originalIdx: number }>>)
    : { 0: tasks.map((t, i) => ({ task: t, originalIdx: i })) };

  return (
    <div className="space-y-3">
      {Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([phaseNum, items]) => (
        <div key={phaseNum}>
          {hasPhases && Number(phaseNum) > 0 && (
            <p className="text-[10px] text-slate-500 dark:text-gray-400 mb-1.5 uppercase">{translate('campaigns.phase')} {phaseNum}</p>
          )}
          {items.map(({ task: t, originalIdx: i }) => {
            const EnergyIcon = ENERGY_ICONS[t.taskEnergyType] || Zap;
            return (
              <Card key={i} className="dark:bg-gray-900 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {editingTaskIdx === i ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editTaskTitle}
                            onChange={(e) => setEditTaskTitle(e.target.value)}
                            className="text-sm bg-transparent border-b border-primary outline-none flex-1 text-slate-900 dark:text-white"
                            autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleSaveTaskTitle(i)}
                          />
                          <button onClick={() => handleSaveTaskTitle(i)} className="text-primary"><CheckCircle2 className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setEditingTaskIdx(null)} className="text-slate-400"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group/task">
                          <p className="text-sm text-slate-900 dark:text-white">{t.title}</p>
                          <button onClick={() => { setEditingTaskIdx(i); setEditTaskTitle(t.title); }} className="opacity-0 group-hover/task:opacity-100 transition-opacity">
                            <Edit2 className="h-3 w-3 text-slate-400" />
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{t.description}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {t.priority === 1 && <div className="w-2 h-2 rounded-full bg-red-400" />}
                      {t.priority === 2 && <div className="w-2 h-2 rounded-full bg-amber-400" />}
                      {t.priority === 3 && <div className="w-2 h-2 rounded-full bg-green-400" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[t.type] || "bg-gray-100 text-gray-700"}`}>
                      {t.type}
                    </Badge>
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-gray-500">
                      <EnergyIcon className="h-3 w-3" />
                      {t.taskEnergyType.replace("_", " ")}
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-gray-500">
                      <Clock className="h-3 w-3" />
                      {t.estimatedDuration}m
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DetailTasksByPhase({ campaignTasks, generatedTasks }: { campaignTasks: Task[]; generatedTasks: GeneratedTask[] | null }) {
  const { t } = useTranslation();
  const phaseMap = new Map<string, number>();
  if (generatedTasks) {
    for (const gt of generatedTasks) {
      if (gt.phase) phaseMap.set(gt.title, gt.phase);
    }
  }

  const hasPhases = generatedTasks?.some(t => t.phase !== undefined) ?? false;

  const grouped = hasPhases
    ? campaignTasks.reduce((acc, t) => {
        const phase = phaseMap.get(t.title) || 0;
        (acc[phase] = acc[phase] || []).push(t);
        return acc;
      }, {} as Record<number, Task[]>)
    : { 0: campaignTasks };

  return (
    <div className="space-y-3">
      {Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([phaseNum, items]) => (
        <div key={phaseNum}>
          {hasPhases && Number(phaseNum) > 0 && (
            <p className="text-[10px] text-slate-500 dark:text-gray-400 mb-1.5 uppercase">{t('campaigns.phase')} {phaseNum}</p>
          )}
          {hasPhases && Number(phaseNum) === 0 && items.length > 0 && (
            <p className="text-[10px] text-slate-500 dark:text-gray-400 mb-1.5 uppercase">{t('campaigns.other')}</p>
          )}
          <div className="space-y-2">
            {items.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  t.completed
                    ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                    : "bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-700"
                }`}
              >
                {t.completed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-gray-600 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${t.completed ? "line-through text-slate-400 dark:text-gray-500" : "text-slate-900 dark:text-white"}`}>
                    {t.title}
                  </p>
                  {t.description && (
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-1">{t.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[t.type] || ""}`}>
                    {t.type}
                  </Badge>
                  {t.estimatedDuration && (
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                      <Clock className="h-3 w-3" />
                      {t.estimatedDuration}m
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface CampaignsProps {
  onSearchClick?: () => void;
}

export default function Campaigns({ onSearchClick }: CampaignsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { triggerAutoRebalance } = useAutoRebalance();

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [panelState, setPanelState] = useState<RightPanelState>("empty");

  const [objective, setObjective] = useState("");
  const [duration, setDuration] = useState("3_months");
  const [weekContext, setWeekContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [showPauseDialog, setShowPauseDialog] = useState(false);
  const [pauseNoteInput, setPauseNoteInput] = useState("");
  const [resumeNoteInput, setResumeNoteInput] = useState("");
  const [startDate, setStartDate] = useState<string>(() => formatLocalDate(new Date()));

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingTaskIdx, setEditingTaskIdx] = useState<number | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [reviewContentQuality, setReviewContentQuality] = useState(0);
  const [reviewAudienceResponse, setReviewAudienceResponse] = useState(0);
  const [reviewTaskExecution, setReviewTaskExecution] = useState(0);
  const [reviewSubmitted, setReviewSubmitted] = useState<number | null>(null);

  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      const primary = projects.find((p) => p.isPrimary) || projects[0];
      setSelectedProjectId(primary.id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    setSelectedCampaignId(null);
    setPanelState("empty");
  }, [selectedProjectId]);

  const { data: campaignList = [], isLoading: campaignsLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns", selectedProjectId],
    queryFn: async () => {
      const url = selectedProjectId
        ? `/api/campaigns?projectId=${selectedProjectId}`
        : "/api/campaigns";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedProjectId,
  });

  const todayStr = formatLocalDate(new Date());
  const pendingReviewCampaign = campaignList.find(
    (c) => c.status === "completed" && !c.reviewedAt && c.endDate && c.endDate < todayStr
  );

  useEffect(() => {
    if (!selectedCampaignId && pendingReviewCampaign) {
      setSelectedCampaignId(pendingReviewCampaign.id);
      setPanelState("detail");
    }
  }, [campaignList, selectedCampaignId, pendingReviewCampaign]);

  const selectedCampaign = campaignList.find((c) => c.id === selectedCampaignId);

  const { data: campaignTasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks", "campaign", selectedCampaignId],
    queryFn: async () => {
      if (!selectedCampaignId) return [];
      const res = await fetch(`/api/tasks?campaignId=${selectedCampaignId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedCampaignId && (selectedCampaign?.status === "active" || selectedCampaign?.status === "completed"),
  });

  const generateMutation = useMutation<GenerateResponse>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/campaigns/generate", {
        objective,
        duration,
        projectId: selectedProjectId,
        weekContext: weekContext || undefined,
        startDate,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedCampaignId(data.campaign.id);
      setDraftName(data.campaign.name);
      setPanelState("generated");
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
    },
    onError: () => toast({ title: t('campaigns.failedToGenerate'), variant: "destructive" }),
  });

  const launchMutation = useMutation({
    mutationFn: async (campaignId: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/launch`, {
        startDate: selectedCampaign?.startDate || undefined,
      });
      return res.json();
    },
    onSuccess: (data: { campaign: Campaign; tasksCreated: number; contentCreated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content"] });
      setPanelState("detail");
      toast({
        title: t('campaigns.campaignDeployed'),
        description: t('campaigns.campaignDeployedDescription', { tasksCreated: data.tasksCreated, contentCreated: data.contentCreated }),
      });
      triggerAutoRebalance();
    },
    onError: () => toast({ title: t('campaigns.failedToLaunch'), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Campaign> }) => {
      const res = await apiRequest("PATCH", `/api/campaigns/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, contentQuality, audienceResponse, taskExecution }: { id: number; contentQuality: number; audienceResponse: number; taskExecution: number }) => {
      const res = await apiRequest("PATCH", `/api/campaigns/${id}/review`, { contentQuality, audienceResponse, taskExecution });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
      setReviewContentQuality(0);
      setReviewAudienceResponse(0);
      setReviewTaskExecution(0);
      setReviewSubmitted(vars.id);
      setTimeout(() => setReviewSubmitted(null), 4000);
    },
    onError: () => toast({ title: t('campaigns.failedToSaveReview'), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
      setSelectedCampaignId(null);
      setPanelState("empty");
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string }) => {
      const res = await apiRequest("POST", `/api/campaigns/${id}/pause`, { pauseNote: note });
      return res.json();
    },
    onSuccess: (data: { campaign: Campaign; tasksRemoved: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setShowPauseDialog(false);
      setPauseNoteInput("");
      toast({ title: t('campaigns.campaignPausedToast'), description: t('campaigns.campaignPausedDescription', { count: data.tasksRemoved }) });
      triggerAutoRebalance();
    },
    onError: () => toast({ title: t('campaigns.failedToPause'), variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string }) => {
      if (note.trim()) {
        await apiRequest("PATCH", `/api/campaigns/${id}`, { pauseNote: note.trim() });
      }
      const resumeRes = await apiRequest("POST", `/api/campaigns/${id}/resume`, {});
      return resumeRes.json();
    },
    onSuccess: (data: { campaign: Campaign; tasksCreated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setResumeNoteInput("");
      toast({ title: t('campaigns.campaignResumed'), description: t('campaigns.campaignResumedDescription', { count: data.tasksCreated }) });
      triggerAutoRebalance();
    },
    onError: () => toast({ title: t('campaigns.failedToResume'), variant: "destructive" }),
  });

  const redeployMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${id}/redeploy`, {});
      return res.json();
    },
    onSuccess: (data: { campaign: Campaign; tasksCreated: number; tasksRemoved: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: t('campaigns.campaignRedeployed'), description: t('campaigns.campaignRedeployedDescription', { tasksRemoved: data.tasksRemoved, tasksCreated: data.tasksCreated }) });
      triggerAutoRebalance();
    },
    onError: () => toast({ title: t('campaigns.failedToRedeploy'), variant: "destructive" }),
  });

  const handleSelectCampaign = (c: Campaign) => {
    setSelectedCampaignId(c.id);
    if (c.status === "draft" && c.generatedTasks) {
      setDraftName(c.name);
      setPanelState("generated");
    } else {
      setPanelState("detail");
    }
  };

  const handleStartNew = () => {
    setSelectedCampaignId(null);
    setObjective("");
    setDuration("3_months");
    setWeekContext("");
    setShowContext(false);
    const d = new Date();
    setStartDate(formatLocalDate(d));
    setPanelState("creating");
  };

  const handleDiscard = () => {
    if (selectedCampaignId) {
      deleteMutation.mutate(selectedCampaignId);
    }
    setPanelState("empty");
  };

  const handleSaveName = () => {
    if (selectedCampaignId && draftName.trim()) {
      updateMutation.mutate({ id: selectedCampaignId, data: { name: draftName.trim() } });
    }
    setEditingName(false);
  };

  const handleSaveTaskTitle = (idx: number) => {
    if (selectedCampaign && editTaskTitle.trim()) {
      const updatedTasks = [...(selectedCampaign.generatedTasks || [])] as GeneratedTask[];
      updatedTasks[idx] = { ...updatedTasks[idx], title: editTaskTitle.trim() };
      updateMutation.mutate({ id: selectedCampaign.id, data: { generatedTasks: updatedTasks } });
    }
    setEditingTaskIdx(null);
  };

  const durationWarning = getDurationWarning(objective, duration);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t('campaigns.title')}{selectedProject ? ` — ${selectedProject.name}` : ""}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('campaigns.defineGoal')}
              </p>
            </div>
            <Button onClick={handleStartNew} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {t('campaigns.createCampaign')}
            </Button>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {projects.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedProjectId === p.id
                      ? "bg-primary text-white"
                      : "bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {projects.length > 5 && (
                <select
                  className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-300"
                  value={selectedProjectId && projects.findIndex((p) => p.id === selectedProjectId) >= 5 ? selectedProjectId : ""}
                  onChange={(e) => setSelectedProjectId(parseInt(e.target.value))}
                >
                  <option value="" disabled>{t('common.more')}</option>
                  {projects.slice(5).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-hidden flex">
          {/* Left Panel — Campaign List */}
          <div className="w-[40%] border-r border-slate-200 dark:border-gray-700 overflow-y-auto p-4 space-y-2">
            {campaignsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : campaignList.length === 0 ? (
              <div className="text-center py-12">
                <Rocket className="h-10 w-10 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500 dark:text-gray-400">{t('campaigns.noCampaigns')}</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={handleStartNew}>
                  {t('campaigns.createFirstCampaign')}
                </Button>
              </div>
            ) : (
              campaignList.map((c) => {
                const statusInfo = STATUS_BADGES[c.status || "draft"];
                const isSelected = selectedCampaignId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => handleSelectCampaign(c)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 dark:bg-primary/10"
                        : "border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-slate-300 dark:hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-900 dark:text-white truncate">
                          {c.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                          {c.objective}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {c.status === "completed" && !c.reviewedAt && c.endDate && c.endDate < todayStr && (
                          <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                            {t('campaigns.needsReview')}
                          </Badge>
                        )}
                        <Badge variant={statusInfo.variant} className="text-[10px]">
                          {t(statusInfo.labelKey)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400 dark:text-gray-500">
                      {c.campaignType && <span className="capitalize">{c.campaignType.replace("_", " ")}</span>}
                      <span>{(c.generatedTasks as GeneratedTask[] | null)?.length || 0} tasks</span>
                      {(c as any).linkedProspectionCampaignId && (
                        <span className="flex items-center gap-1 text-indigo-500 dark:text-indigo-400">
                          <span>🎯</span> Prospection liée
                        </span>
                      )}
                      {c.createdAt && (
                        <span>
                          {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right Panel — Detail / Creation */}
          <div className="w-[60%] overflow-y-auto p-6">
            {panelState === "empty" && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                  <Rocket className="h-8 w-8 text-slate-400 dark:text-gray-500" />
                </div>
                <p className="text-lg text-slate-900 dark:text-white mb-1">
                  {t('campaigns.campaignEngine')}
                </p>
                <p className="text-sm text-slate-500 dark:text-gray-400 max-w-sm mb-6">
                  {t('campaigns.campaignEngineDescription')}
                </p>
                <Button onClick={handleStartNew}>
                  {t('campaigns.startNewCampaign')} <span className="ml-1">→</span>
                </Button>
              </div>
            )}

            {panelState === "creating" && (
              <div className="max-w-lg mx-auto space-y-5">
                <h2 className="text-lg text-slate-900 dark:text-white">{t('campaigns.newCampaignTitle')}</h2>

                <div>
                  <label className="text-sm text-slate-700 dark:text-gray-300 block mb-1.5">
                    {t('campaigns.whatToAchieve')}
                  </label>
                  <Textarea
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder={t('campaigns.objectiveCreatePlaceholder')}
                    className="min-h-[80px] resize-none"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-700 dark:text-gray-300 block mb-1.5">
                    {t('campaigns.duration')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setDuration(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          duration === opt.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300"
                        }`}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                  {durationWarning && (
                    <div className="flex items-start gap-2 mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">{durationWarning}</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm text-slate-700 dark:text-gray-300 block mb-1.5">
                    {t('campaigns.campaignStartDate')}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full text-sm border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-900 dark:text-white"
                  />
                  <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">
                    {t('campaigns.startDateDescription')}
                  </p>
                </div>

                <div>
                  <button
                    onClick={() => setShowContext(!showContext)}
                    className="text-xs text-slate-500 dark:text-gray-400 hover:text-primary transition-colors"
                  >
                    {showContext ? "▼" : "▶"} {t('campaigns.additionalContext')}
                  </button>
                  {showContext && (
                    <Textarea
                      value={weekContext}
                      onChange={(e) => setWeekContext(e.target.value)}
                      placeholder={t('campaigns.contextPlaceholder')}
                      className="mt-2 min-h-[60px] resize-none text-sm"
                    />
                  )}
                </div>

                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={!objective.trim() || generateMutation.isPending}
                  className="w-full"
                >
                  {generateMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('campaigns.buildingArchitecture')}
                    </span>
                  ) : (
                    <>{t('campaigns.generatePlan')} <span className="ml-1">→</span></>
                  )}
                </Button>
              </div>
            )}

            {panelState === "generated" && selectedCampaign && (
              <div className="space-y-5">
                {/* Campaign Name (editable) */}
                <div>
                  {editingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className="text-xl bg-transparent border-b-2 border-primary outline-none text-slate-900 dark:text-white flex-1"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                      />
                      <button onClick={handleSaveName} className="text-primary"><CheckCircle2 className="h-5 w-5" /></button>
                      <button onClick={() => setEditingName(false)} className="text-slate-400"><X className="h-5 w-5" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <h2 className="text-xl text-slate-900 dark:text-white">{selectedCampaign.name}</h2>
                      <button onClick={() => { setDraftName(selectedCampaign.name); setEditingName(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit2 className="h-4 w-4 text-slate-400" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px]">{t('campaigns.draft')}</Badge>
                    {selectedCampaign.campaignType && (
                      <span className="text-[10px] text-slate-400 capitalize">{selectedCampaign.campaignType.replace("_", " ")}</span>
                    )}
                    {selectedCampaign.duration && (
                      <span className="text-[10px] text-slate-400">{selectedCampaign.duration.replace("_", " ")}</span>
                    )}
                  </div>
                  {selectedCampaign.objective && selectedCampaign.duration && getDurationWarning(selectedCampaign.objective, selectedCampaign.duration) && (
                    <div className="flex items-center gap-2 mt-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">{getDurationWarning(selectedCampaign.objective, selectedCampaign.duration)}</p>
                    </div>
                  )}
                </div>

                {/* Prospection liée */}
                {(selectedCampaign as any).linkedProspectionCampaignId && (
                  <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-3 border border-violet-200 dark:border-violet-800/50 flex items-center gap-3">
                    <span className="text-lg">🎯</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-violet-800 dark:text-violet-300">Campagne de prospection associée</p>
                      <p className="text-[11px] text-violet-600 dark:text-violet-400 mt-0.5">Naya a créé une campagne de prospection liée à cet objectif.</p>
                    </div>
                    <a href="/outreach" className="text-xs px-2.5 py-1 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors flex-shrink-0">
                      Voir →
                    </a>
                  </div>
                )}

                {/* Core Message */}
                {selectedCampaign.coreMessage && (
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-4 border-l-4 border-indigo-400 dark:border-indigo-600">
                    <p className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">{t('campaigns.coreMessage')}</p>
                    <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed">{selectedCampaign.coreMessage}</p>
                  </div>
                )}

                {/* Target Audience + Segment */}
                {(selectedCampaign.targetAudience || selectedCampaign.audienceSegment) && (
                  <div className="space-y-1">
                    {selectedCampaign.targetAudience && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
                        <Target className="h-4 w-4 flex-shrink-0" />
                        <span>{selectedCampaign.targetAudience}</span>
                      </div>
                    )}
                    {selectedCampaign.audienceSegment && selectedCampaign.audienceSegment !== selectedCampaign.targetAudience && (
                      <p className="text-xs text-slate-400 dark:text-gray-500 ml-6">{t('campaigns.segment')}: {selectedCampaign.audienceSegment}</p>
                    )}
                  </div>
                )}

                {/* Insights */}
                {selectedCampaign.insights && (selectedCampaign.insights as string[]).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500">{t('campaigns.strategicInsights')}</p>
                    {(selectedCampaign.insights as string[]).map((insight, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${INSIGHT_COLORS[i % INSIGHT_COLORS.length]}`} />
                        <p className="text-sm text-slate-700 dark:text-gray-300">{insight}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Architecture Sections */}
                <CampaignArchitectureSections campaign={selectedCampaign} />

                {/* Generated Tasks */}
                {selectedCampaign.generatedTasks && (
                  <CollapsibleSection title={`${t('campaigns.tasks')} (${(selectedCampaign.generatedTasks as GeneratedTask[]).length})`}>
                    <TasksByPhase
                      tasks={selectedCampaign.generatedTasks as GeneratedTask[]}
                      editingTaskIdx={editingTaskIdx}
                      editTaskTitle={editTaskTitle}
                      setEditingTaskIdx={setEditingTaskIdx}
                      setEditTaskTitle={setEditTaskTitle}
                      handleSaveTaskTitle={handleSaveTaskTitle}
                    />
                  </CollapsibleSection>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => launchMutation.mutate(selectedCampaign.id)}
                    disabled={launchMutation.isPending}
                    className="flex-1"
                  >
                    {launchMutation.isPending ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t('campaigns.launching')}</span>
                    ) : t('campaigns.launchCampaign')}
                  </Button>
                  <Button variant="ghost" onClick={handleDiscard} disabled={deleteMutation.isPending}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {t('campaigns.discard')}
                  </Button>
                </div>
              </div>
            )}

            {panelState === "detail" && selectedCampaign && (
              <div className="space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl text-slate-900 dark:text-white">{selectedCampaign.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={STATUS_BADGES[selectedCampaign.status || "draft"].variant}>
                        {t(STATUS_BADGES[selectedCampaign.status || "draft"].labelKey)}
                      </Badge>
                      {selectedCampaign.campaignType && (
                        <span className="text-[10px] text-slate-400 capitalize">{selectedCampaign.campaignType.replace("_", " ")}</span>
                      )}
                      {selectedCampaign.duration && (
                        <span className="text-xs text-slate-400 dark:text-gray-500">
                          {selectedCampaign.duration.replace("_", " ")}
                        </span>
                      )}
                      {selectedCampaign.startDate && selectedCampaign.endDate && (
                        <span className="text-[10px] text-slate-400 dark:text-gray-500">
                          {selectedCampaign.startDate} → {selectedCampaign.endDate}
                        </span>
                      )}
                    </div>
                    {selectedCampaign.objective && selectedCampaign.duration && getDurationWarning(selectedCampaign.objective, selectedCampaign.duration) && (
                      <div className="flex items-center gap-2 mt-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">{getDurationWarning(selectedCampaign.objective, selectedCampaign.duration)}</p>
                      </div>
                    )}
                  </div>
                  {selectedCampaign.startDate && (
                    <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg px-4 py-3 text-xs text-slate-500 dark:text-gray-400 space-y-1">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          {t('campaigns.starts')} <strong className="text-slate-700 dark:text-gray-300">{selectedCampaign.startDate}</strong>
                          {selectedCampaign.endDate && (
                            <> → {t('campaigns.ends')} <strong className="text-slate-700 dark:text-gray-300">{selectedCampaign.endDate}</strong></>
                          )}
                        </span>
                      </div>
                      {selectedCampaign.tasksGenerated && (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          <span>{t('campaigns.tasksDeployedToCalendar')}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {selectedCampaign.status === "active" && !showPauseDialog && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setShowPauseDialog(true); setPauseNoteInput(""); }}>
                          <Pause className="h-3.5 w-3.5 mr-1" />
                          {t('campaigns.pause')}
                        </Button>
                        {selectedCampaign.tasksGenerated && (
                          <Button size="sm" variant="outline"
                            onClick={() => redeployMutation.mutate(selectedCampaign.id)}
                            disabled={redeployMutation.isPending}>
                            {redeployMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                            {t('campaigns.redeploy')}
                          </Button>
                        )}
                        <Button size="sm" onClick={() => { updateMutation.mutate({ id: selectedCampaign.id, data: { status: "completed" } }); toast({ title: t('campaigns.campaignMarkedComplete') }); }}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          {t('campaigns.markComplete')}
                        </Button>
                      </div>
                    )}
                    {selectedCampaign.status === "active" && showPauseDialog && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                        <p className="text-xs text-amber-700 dark:text-amber-400">{t('campaigns.pauseThisCampaign')}</p>
                        <p className="text-xs text-slate-500 dark:text-gray-400">{t('campaigns.pauseDescription')}</p>
                        <Textarea
                          placeholder={t('campaigns.pauseAIInstruction')}
                          value={pauseNoteInput}
                          onChange={(e) => setPauseNoteInput(e.target.value)}
                          className="text-xs min-h-[60px] resize-none"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-100 dark:text-amber-400 dark:border-amber-700"
                            onClick={() => pauseMutation.mutate({ id: selectedCampaign.id, note: pauseNoteInput })}
                            disabled={pauseMutation.isPending}>
                            {pauseMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                            {t('campaigns.confirmPause')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowPauseDialog(false)}>
                            <X className="h-3.5 w-3.5 mr-1" />{t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    )}
                    {selectedCampaign.status === "paused" && (
                      <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-3 space-y-2">
                        <p className="text-xs text-indigo-700 dark:text-indigo-400">{t('campaigns.campaignPausedLabel')}</p>
                        {selectedCampaign.pauseNote && (
                          <div className="rounded bg-indigo-100 dark:bg-indigo-900/40 px-2 py-1.5">
                            <p className="text-[10px] uppercase tracking-wider text-indigo-500 mb-0.5">{t('campaigns.savedNote')}</p>
                            <p className="text-xs text-slate-600 dark:text-gray-300">{selectedCampaign.pauseNote}</p>
                          </div>
                        )}
                        <Textarea
                          placeholder={t('campaigns.resumeAIInstruction')}
                          value={resumeNoteInput}
                          onChange={(e) => setResumeNoteInput(e.target.value)}
                          className="text-xs min-h-[60px] resize-none"
                        />
                        <Button size="sm"
                          onClick={() => resumeMutation.mutate({ id: selectedCampaign.id, note: resumeNoteInput })}
                          disabled={resumeMutation.isPending}>
                          {resumeMutation.isPending
                            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{resumeNoteInput.trim() ? t('campaigns.applyingChanges') : t('campaigns.resumingLabel')}</>
                            : <><Rocket className="h-3.5 w-3.5 mr-1" />{resumeNoteInput.trim() ? t('campaigns.modifyAndResume') : t('campaigns.resumeCampaign')}</>
                          }
                        </Button>
                      </div>
                    )}
                    {selectedCampaign.status === "completed" && !selectedCampaign.reviewedAt && selectedCampaign.endDate && selectedCampaign.endDate < formatLocalDate(new Date()) && reviewSubmitted !== selectedCampaign.id && (
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-3">
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('campaigns.howDidItGo')}</p>
                        <p className="text-xs text-slate-500 dark:text-gray-400">{t('campaigns.rateThreeDimensions')}</p>
                        {([
                          { key: 'contentQuality' as const, label: t('campaigns.contentQuality'), value: reviewContentQuality, set: setReviewContentQuality },
                          { key: 'audienceResponse' as const, label: t('campaigns.audienceResponse'), value: reviewAudienceResponse, set: setReviewAudienceResponse },
                          { key: 'taskExecution' as const, label: t('campaigns.taskExecution'), value: reviewTaskExecution, set: setReviewTaskExecution },
                        ]).map(dim => (
                          <div key={dim.key}>
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{dim.label}</p>
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button key={star} onClick={() => dim.set(star)} className={`text-lg transition-colors ${dim.value >= star ? 'text-yellow-500' : 'text-slate-300 dark:text-gray-600 hover:text-yellow-300'}`}>★</button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Button size="sm" disabled={reviewContentQuality === 0 || reviewAudienceResponse === 0 || reviewTaskExecution === 0 || reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: selectedCampaign.id, contentQuality: reviewContentQuality, audienceResponse: reviewAudienceResponse, taskExecution: reviewTaskExecution })}>
                          {reviewMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('campaigns.saving')}</> : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{t('campaigns.submitReview')}</>}
                        </Button>
                      </div>
                    )}
                    {reviewSubmitted === selectedCampaign.id && (
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-center">
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('campaigns.reviewThanks')}</p>
                      </div>
                    )}
                    {selectedCampaign.status === "completed" && selectedCampaign.reviewedAt && (
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-2">
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('campaigns.campaignReview')}</p>
                        {([
                          { label: t('campaigns.contentQuality'), val: selectedCampaign.reviewContentQuality },
                          { label: t('campaigns.audienceResponse'), val: selectedCampaign.reviewAudienceResponse },
                          { label: t('campaigns.taskExecution'), val: selectedCampaign.reviewTaskExecution },
                        ]).map(dim => (
                          <div key={dim.label} className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wider text-slate-400">{dim.label}</span>
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map(star => (
                                <span key={star} className={`text-sm ${(dim.val || 0) >= star ? 'text-yellow-500' : 'text-slate-300 dark:text-gray-600'}`}>★</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Core Message */}
                {selectedCampaign.coreMessage && (
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-4 border-l-4 border-indigo-400 dark:border-indigo-600">
                    <p className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">{t('campaigns.coreMessage')}</p>
                    <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed">{selectedCampaign.coreMessage}</p>
                  </div>
                )}

                {/* Target Audience + Segment */}
                {(selectedCampaign.targetAudience || selectedCampaign.audienceSegment) && (
                  <div className="space-y-1">
                    {selectedCampaign.targetAudience && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
                        <Target className="h-4 w-4 flex-shrink-0" />
                        <span>{selectedCampaign.targetAudience}</span>
                      </div>
                    )}
                    {selectedCampaign.audienceSegment && selectedCampaign.audienceSegment !== selectedCampaign.targetAudience && (
                      <p className="text-xs text-slate-400 dark:text-gray-500 ml-6">{t('campaigns.segment')}: {selectedCampaign.audienceSegment}</p>
                    )}
                  </div>
                )}

                {/* Insights */}
                {selectedCampaign.insights && (selectedCampaign.insights as string[]).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500">{t('campaigns.strategicInsights')}</p>
                    {(selectedCampaign.insights as string[]).map((insight, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${INSIGHT_COLORS[i % INSIGHT_COLORS.length]}`} />
                        <p className="text-sm text-slate-700 dark:text-gray-300">{insight}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Architecture Sections */}
                <CampaignArchitectureSections campaign={selectedCampaign} />

                {/* Task List (live from DB for active/completed) */}
                <CollapsibleSection title={`${t('campaigns.tasks')} (${campaignTasks.length > 0 ? campaignTasks.length : (selectedCampaign.generatedTasks as GeneratedTask[] | null)?.length || 0})`}>
                  {campaignTasks.length > 0 ? (
                    <DetailTasksByPhase
                      campaignTasks={campaignTasks}
                      generatedTasks={selectedCampaign.generatedTasks as GeneratedTask[] | null}
                    />
                  ) : (
                    <TasksByPhase
                      tasks={(selectedCampaign.generatedTasks as GeneratedTask[]) || []}
                      editingTaskIdx={null}
                      editTaskTitle=""
                      setEditingTaskIdx={() => {}}
                      setEditTaskTitle={() => {}}
                      handleSaveTaskTitle={() => {}}
                    />
                  )}
                </CollapsibleSection>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
