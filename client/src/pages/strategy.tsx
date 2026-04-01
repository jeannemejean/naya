import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Target, Plus, Eye, CheckCircle2, Trash2, Edit2, X, ChevronDown, ChevronUp,
  Clock, Loader2, RefreshCw, Compass, PlusCircle, FileText, Radio, BarChart3,
  BookOpen, Archive
} from "lucide-react";
import type { MilestoneTrigger, Project, BrandDna, BusinessMemory } from "@shared/schema";
import { getISOWeekNumber, formatLocalDate } from "@/lib/dateUtils";

type UnlockedTask = {
  title: string;
  description: string;
  type?: string;
  category?: string;
  priority?: number;
  estimatedDuration?: number;
  taskEnergyType?: string;
};

type ParsedPreview = {
  conditionType: string;
  conditionSummary: string;
  conditionKeywords: string[];
  tasksToUnlock: UnlockedTask[];
  schedulingMode: string;
  reasoning: string;
};

type WeeklyPlan = {
  contentStrategy?: string;
  outreachStrategy?: string;
  metrics?: string;
};

type WeeklyStrategy = {
  weeklyFocus: string;
  insights: string[];
  recommendations: string[];
  nextWeekPlan: WeeklyPlan;
};

type StrategyGenerateResponse = {
  weeklyFocus: string;
  insights: string[];
  recommendations: string[];
  nextWeekPlan: WeeklyPlan;
  report?: {
    id: number;
    createdAt: string;
  };
};

interface StrategyProps {
  onSearchClick?: () => void;
}

function localDateStr(d: Date): string {
  return formatLocalDate(d);
}

function daysAgoDiff(dateStr: string | Date | null | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

const INSIGHT_COLORS = ['bg-indigo-400', 'bg-violet-400', 'bg-cyan-400', 'bg-emerald-400'];

export default function Strategy({ onSearchClick }: StrategyProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      const primary = projects.find(p => p.isPrimary) || projects[0];
      setSelectedProjectId(primary.id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const { data: projectDna, isLoading: dnaLoading } = useQuery<BrandDna | null>({
    queryKey: ['/api/projects', selectedProjectId, 'brand-dna'],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const res = await apiRequest('GET', `/api/projects/${selectedProjectId}/brand-dna`);
      return res.json();
    },
    enabled: !!selectedProjectId,
  });

  const currentWeek = (() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-W' + getISOWeekNumber(now);
  })();

  const { data: existingReport } = useQuery({
    queryKey: ['/api/strategy/report', selectedProjectId, currentWeek],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const res = await apiRequest('GET', `/api/strategy/report?week=${currentWeek}&projectId=${selectedProjectId}`);
      return res.json();
    },
    enabled: !!selectedProjectId,
  });

  const [weeklyStrategy, setWeeklyStrategy] = useState<WeeklyStrategy | null>(null);
  const [weekContext, setWeekContext] = useState('');
  const [showFullSummary, setShowFullSummary] = useState(false);

  useEffect(() => {
    if (existingReport?.focus) {
      setWeeklyStrategy({
        weeklyFocus: existingReport.focus,
        insights: existingReport.reasoning ? [existingReport.reasoning] : [],
        recommendations: existingReport.recommendations || [],
        nextWeekPlan: existingReport.weeklyPlan || {},
      });
    } else {
      setWeeklyStrategy(null);
    }
  }, [existingReport, selectedProjectId]);

  useEffect(() => {
    setWeeklyStrategy(null);
    setWeekContext('');
    setShowFullSummary(false);
  }, [selectedProjectId]);

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/brand-dna/refresh-intelligence', { projectId: selectedProjectId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', selectedProjectId, 'brand-dna'] });
      toast({ title: t('strategy.strategicBriefUpdated', { name: selectedProject?.name }) });
    },
    onError: () => toast({ title: t('strategy.failedToRefresh'), variant: "destructive" }),
  });

  const generateMutation = useMutation<StrategyGenerateResponse>({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/strategy/generate', {
        projectId: selectedProjectId,
        weekContext,
      });
      return res.json() as Promise<StrategyGenerateResponse>;
    },
    onSuccess: (data) => {
      setWeeklyStrategy({
        weeklyFocus: data.weeklyFocus,
        insights: data.insights || [],
        recommendations: data.recommendations || [],
        nextWeekPlan: data.nextWeekPlan || {},
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategy/report', selectedProjectId, currentWeek] });
    },
    onError: () => toast({ title: t('strategy.failedToGenerate'), variant: "destructive" }),
  });

  const addToPlanner = async (recommendation: string) => {
    try {
      await apiRequest('POST', '/api/tasks', {
        title: recommendation,
        type: 'planning',
        category: 'planning',
        priority: 2,
        source: 'strategy',
        projectId: selectedProjectId,
        scheduledDate: localDateStr(new Date()),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: t('strategy.addedToYourPlan') });
    } catch {
      toast({ title: t('strategy.failedToAddTask'), variant: "destructive" });
    }
  };

  // ─── Conditional Rules State ──────────────────────────────────────
  const [ruleText, setRuleText] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);

  const { data: triggers = [], isLoading: triggersLoading } = useQuery<MilestoneTrigger[]>({
    queryKey: ['/api/milestone-triggers'],
    refetchInterval: 5000,
  });

  const previewMutation = useMutation({
    mutationFn: async (rawCondition: string) => {
      const res = await apiRequest('POST', '/api/milestone-triggers/preview', { rawCondition });
      return res.json() as Promise<ParsedPreview>;
    },
    onSuccess: (data: ParsedPreview) => setPreview(data),
    onError: () => toast({ title: t('strategy.failedToParseRule'), variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: { rawCondition: string; conditionType: string; conditionSummary: string; conditionKeywords: string[]; tasksToUnlock: UnlockedTask[]; schedulingMode: string; projectId?: number | null }) => {
      const res = await apiRequest('POST', '/api/milestone-triggers', data);
      return res.json();
    },
    onSuccess: () => {
      setRuleText("");
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ['/api/milestone-triggers'] });
      toast({ title: t('strategy.ruleCreated') });
    },
    onError: () => toast({ title: t('strategy.failedToCreateRule'), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<MilestoneTrigger> }) => {
      const res = await apiRequest('PATCH', `/api/milestone-triggers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      setEditText("");
      queryClient.invalidateQueries({ queryKey: ['/api/milestone-triggers'] });
      toast({ title: t('strategy.ruleUpdated') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/milestone-triggers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/milestone-triggers'] });
      toast({ title: t('strategy.ruleDeleted') });
    },
  });

  const handleParseRule = () => {
    if (!ruleText.trim()) return;
    previewMutation.mutate(ruleText.trim());
  };

  const handleConfirmRule = () => {
    if (!preview) return;
    createMutation.mutate({
      rawCondition: ruleText.trim(),
      conditionType: preview.conditionType,
      conditionSummary: preview.conditionSummary,
      conditionKeywords: preview.conditionKeywords,
      tasksToUnlock: preview.tasksToUnlock,
      schedulingMode: preview.schedulingMode,
      projectId: selectedProjectId,
    });
  };

  const handleCancelPreview = () => setPreview(null);

  const watchingTriggers = triggers.filter(t => t.status === 'watching');
  const triggeredTriggers = triggers.filter(t => t.status === 'triggered');
  const dismissedTriggers = triggers.filter(t => t.status === 'dismissed');

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-gray-950">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-900 border-b border-slate-200 dark:border-gray-700 px-6 py-4">
          <h1 className="text-2xl text-slate-900 dark:text-white">
            {t('strategy.title')}{selectedProject ? ` — ${selectedProject.name}` : ''}
          </h1>
          <p className="text-slate-600 dark:text-gray-400 mt-1">
            {t('strategy.subtitle')}
          </p>

          {projects.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {projects.slice(0, 5).map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedProjectId === p.id
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {projects.length > 5 && (
                <select
                  className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-300"
                  value={selectedProjectId && projects.findIndex(p => p.id === selectedProjectId) >= 5 ? selectedProjectId : ''}
                  onChange={e => setSelectedProjectId(parseInt(e.target.value))}
                >
                  <option value="" disabled>{t('common.more')}</option>
                  {projects.slice(5).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ─── Section 1: Strategic Intelligence ─── */}
          <Card className="dark:bg-gray-900 dark:border-gray-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-slate-900 dark:text-white">
                  {t('strategy.nayasRead', { name: selectedProject?.name || 'your project' })}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {projectDna?.lastStrategyRefreshAt && (
                    <span className="text-[11px] text-slate-400 dark:text-gray-500">
                      {(() => {
                        const diff = daysAgoDiff(projectDna.lastStrategyRefreshAt);
                        if (diff === null) return '';
                        if (diff === 0) return t('common.updatedToday');
                        if (diff === 1) return t('common.updatedYesterday');
                        return t('common.updatedDaysAgo', { count: diff });
                      })()}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending || !selectedProjectId}
                    className="h-7 px-2"
                  >
                    {refreshMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5 text-xs">{t('common.refresh')}</span>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {dnaLoading ? (
                <div className="h-24 bg-slate-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : projectDna?.nayaIntelligenceSummary ? (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-4 border-l-4 border-indigo-400 dark:border-indigo-600">
                  <p className={`text-sm leading-relaxed text-slate-700 dark:text-gray-300 whitespace-pre-line ${!showFullSummary ? 'line-clamp-5' : ''}`}>
                    {projectDna.nayaIntelligenceSummary}
                  </p>
                  {projectDna.nayaIntelligenceSummary.length > 400 && (
                    <button
                      onClick={() => setShowFullSummary(!showFullSummary)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 mt-2 hover:underline"
                    >
                      {showFullSummary ? t('strategy.showLess') : t('strategy.readMore')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-200 dark:border-gray-700 rounded-lg p-8 text-center">
                  <p className="text-sm text-slate-500 dark:text-gray-400 mb-3">
                    {t('strategy.notAnalyzedYet', { name: selectedProject?.name || 'this project' })}
                  </p>
                  <Button
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending || !selectedProjectId}
                  >
                    {refreshMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        {t('common.analyzing')}
                      </>
                    ) : t('strategy.generateBrief')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── Section 2: Weekly Command ─── */}
          <Card className="dark:bg-gray-900 dark:border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Compass className="h-4 w-4 text-primary" />
                {t('strategy.weeklyCommand')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!weeklyStrategy ? (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <Compass className="h-10 w-10 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-700 dark:text-gray-300 mb-1">
                      {t('strategy.noStrategyYet', { name: selectedProject?.name || 'this project' })}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">
                      {t('strategy.tellMeWhatsGoing')}
                    </p>
                  </div>
                  <Textarea
                    value={weekContext}
                    onChange={e => setWeekContext(e.target.value)}
                    placeholder={t('strategy.weekContextPlaceholder')}
                    className="min-h-[80px] text-sm resize-none"
                  />
                  <Button
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending || !selectedProjectId}
                    className="w-full"
                  >
                    {generateMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('strategy.nayaThinking')}
                      </span>
                    ) : (
                      t('strategy.generateMyWeek')
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Sub-card A: Weekly Focus */}
                  <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4">
                    <p className="text-lg text-slate-900 dark:text-white">
                      {weeklyStrategy.weeklyFocus}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">
                      {t('strategy.strategicNorthStar', { name: selectedProject?.name || 'this project' })}
                    </p>
                  </div>

                  {/* Sub-card B: Angles & Moves */}
                  <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-4">
                    {weeklyStrategy.insights.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">
                          {t('strategy.thisWeeksAngles')}
                        </p>
                        <div className="space-y-2">
                          {weeklyStrategy.insights.map((insight, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${INSIGHT_COLORS[i % INSIGHT_COLORS.length]}`} />
                              <p className="text-sm text-slate-700 dark:text-gray-300">{insight}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {weeklyStrategy.recommendations.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">
                          {t('strategy.recommendedMoves')}
                        </p>
                        <div className="space-y-1.5">
                          {weeklyStrategy.recommendations.map((rec, i) => (
                            <div key={i} className="flex items-center justify-between group p-2 rounded-md hover:bg-white dark:hover:bg-gray-700/50 transition-colors">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                                <p className="text-sm text-slate-700 dark:text-gray-300 truncate">{rec}</p>
                              </div>
                              <button
                                onClick={() => addToPlanner(rec)}
                                className="text-[11px] text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap flex items-center gap-1 ml-2"
                              >
                                <PlusCircle className="h-3 w-3" />
                                {t('strategy.addToPlanner')}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sub-card C: Direction this week */}
                  {weeklyStrategy.nextWeekPlan && (
                    <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">
                        {t('strategy.directionThisWeek')}
                      </p>
                      <div className="space-y-2">
                        {weeklyStrategy.nextWeekPlan.contentStrategy && (
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-slate-600 dark:text-gray-400">{t('strategy.content')}</span>
                              <p className="text-sm text-slate-700 dark:text-gray-300">{weeklyStrategy.nextWeekPlan.contentStrategy}</p>
                            </div>
                          </div>
                        )}
                        {weeklyStrategy.nextWeekPlan.outreachStrategy && (
                          <div className="flex items-start gap-2">
                            <Radio className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-slate-600 dark:text-gray-400">{t('strategy.outreach')}</span>
                              <p className="text-sm text-slate-700 dark:text-gray-300">{weeklyStrategy.nextWeekPlan.outreachStrategy}</p>
                            </div>
                          </div>
                        )}
                        {weeklyStrategy.nextWeekPlan.metrics && (
                          <div className="flex items-start gap-2">
                            <BarChart3 className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-slate-600 dark:text-gray-400">{t('strategy.watch')}</span>
                              <p className="text-sm text-slate-700 dark:text-gray-300">{weeklyStrategy.nextWeekPlan.metrics}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    {existingReport?.createdAt && (
                      <p className="text-[11px] text-slate-400 dark:text-gray-500">
                        Generated {new Date(existingReport.createdAt).toLocaleDateString()}
                      </p>
                    )}
                    <button
                      onClick={() => { setWeeklyStrategy(null); setWeekContext(''); }}
                      className="text-xs text-primary hover:underline"
                    >
                      {t('strategy.regenerate')} →
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── Section 3: Business Memory ─── */}
          <BusinessMemorySection />

          {/* ─── Section 4: Conditional Rules ─── */}
          <Card className="dark:bg-gray-900 dark:border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                {t('strategy.conditionalRules')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!preview ? (
                <>
                  <div className="flex gap-2">
                    <Textarea
                      value={ruleText}
                      onChange={e => setRuleText(e.target.value)}
                      placeholder={t('strategy.rulePlaceholder')}
                      className="flex-1 min-h-[60px] max-h-[120px] text-sm resize-none"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleParseRule();
                        }
                      }}
                    />
                    <Button
                      onClick={handleParseRule}
                      disabled={!ruleText.trim() || previewMutation.isPending}
                      className="self-start"
                    >
                      {previewMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          {t('strategy.parsingRule')}
                        </>
                      ) : t('strategy.parseRule')}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-2">
                    {t('strategy.naturalLanguageHint')}
                  </p>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-2">{t('strategy.nayaParsedRule')}</p>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[11px] text-slate-500 dark:text-gray-400">{t('strategy.conditionLabel')}</span>
                        <p className="text-sm text-slate-900 dark:text-white">{preview.conditionSummary}</p>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 dark:text-gray-400">{t('strategy.typeLabel')}</span>
                        <Badge variant="outline" className="ml-1 text-[10px]">{preview.conditionType}</Badge>
                        <Badge variant="outline" className="ml-1 text-[10px]">{preview.schedulingMode}</Badge>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 dark:text-gray-400">{t('strategy.keywordsLabel')}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {preview.conditionKeywords.map((kw, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 rounded">{kw}</span>
                          ))}
                        </div>
                      </div>
                      {preview.tasksToUnlock.length > 0 && (
                        <div>
                          <span className="text-[11px] text-slate-500 dark:text-gray-400">{t('strategy.tasksToUnlockHeader')} ({preview.tasksToUnlock.length}):</span>
                          <div className="mt-1 space-y-1">
                            {preview.tasksToUnlock.map((task, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-slate-100 dark:border-gray-700">
                                <span className="text-xs text-slate-400 mt-0.5">{i + 1}.</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-slate-700 dark:text-gray-300">{task.title}</p>
                                  {task.description && (
                                    <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>
                                  )}
                                  <div className="flex items-center gap-2 mt-1">
                                    {task.type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400">{task.type}</span>}
                                    {task.estimatedDuration && <span className="text-[10px] text-slate-400">{task.estimatedDuration}min</span>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {preview.reasoning && (
                        <p className="text-[11px] text-slate-400 dark:text-gray-500 italic">{preview.reasoning}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleConfirmRule} disabled={createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">
                      {createMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          {t('strategy.saving')}
                        </>
                      ) : t('strategy.confirmAndWatch')}
                    </Button>
                    <Button variant="outline" onClick={handleCancelPreview}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {watchingTriggers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm text-slate-700 dark:text-gray-300 flex items-center gap-2">
                <Eye className="h-4 w-4" />
                {t('strategy.watching')} ({watchingTriggers.length})
              </h2>
              {watchingTriggers.map(trigger => (
                <TriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  isExpanded={expandedId === trigger.id}
                  isEditing={editingId === trigger.id}
                  editText={editText}
                  onToggleExpand={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
                  onStartEdit={() => { setEditingId(trigger.id); setEditText(trigger.conditionSummary || trigger.rawCondition); }}
                  onCancelEdit={() => { setEditingId(null); setEditText(""); }}
                  onSaveEdit={() => updateMutation.mutate({ id: trigger.id, data: { conditionSummary: editText } })}
                  onEditTextChange={setEditText}
                  onDismiss={() => updateMutation.mutate({ id: trigger.id, data: { status: 'dismissed' } })}
                  onDelete={() => deleteMutation.mutate(trigger.id)}
                />
              ))}
            </div>
          )}

          {triggeredTriggers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm text-slate-700 dark:text-gray-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {t('strategy.triggered')} ({triggeredTriggers.length})
              </h2>
              {triggeredTriggers.map(trigger => (
                <TriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  isExpanded={expandedId === trigger.id}
                  isEditing={false}
                  editText=""
                  onToggleExpand={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
                  onStartEdit={() => {}}
                  onCancelEdit={() => {}}
                  onSaveEdit={() => {}}
                  onEditTextChange={() => {}}
                  onDismiss={() => {}}
                  onDelete={() => deleteMutation.mutate(trigger.id)}
                />
              ))}
            </div>
          )}

          {dismissedTriggers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm text-slate-500 dark:text-gray-500 flex items-center gap-2">
                {t('strategy.dismissed')} ({dismissedTriggers.length})
              </h2>
              {dismissedTriggers.map(trigger => (
                <TriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  isExpanded={expandedId === trigger.id}
                  isEditing={false}
                  editText=""
                  onToggleExpand={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
                  onStartEdit={() => {}}
                  onCancelEdit={() => {}}
                  onSaveEdit={() => {}}
                  onEditTextChange={() => {}}
                  onDismiss={() => {}}
                  onDelete={() => deleteMutation.mutate(trigger.id)}
                />
              ))}
            </div>
          )}

          {triggersLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-20 bg-slate-100 dark:bg-gray-800 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!triggersLoading && triggers.length === 0 && (
            <div className="text-center py-12">
              <Target className="h-10 w-10 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
              <h3 className="text-sm text-slate-700 dark:text-gray-300 mb-1">{t('strategy.noRulesYet')}</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                {t('strategy.noRulesDescription')}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const MEMORY_TYPES = [
  { value: 'decision', label: 'Decision', icon: '⚖️', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'lesson', label: 'Lesson', icon: '📚', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'pivot', label: 'Pivot', icon: '🔄', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  { value: 'milestone', label: 'Milestone', icon: '🏆', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'observation', label: 'Observation', icon: '👁️', color: 'bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-300' },
];

function BusinessMemorySection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('observation');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState('');

  const { data: memories = [], isLoading } = useQuery<BusinessMemory[]>({
    queryKey: ['/api/memory', showArchived ? 'all' : 'active'],
    queryFn: async () => {
      const params = showArchived ? '?archived=all' : '';
      const res = await apiRequest('GET', `/api/memory${params}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { type: string; content: string }) => {
      const res = await apiRequest('POST', '/api/memory', data);
      return res.json();
    },
    onSuccess: () => {
      setNewContent('');
      setNewType('observation');
      queryClient.invalidateQueries({ queryKey: ['/api/memory'] });
      toast({ title: t('strategy.memorySaved') });
    },
    onError: () => toast({ title: t('strategy.failedToSaveMemory'), variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/memory/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/memory'] });
      toast({ title: t('strategy.memoryArchived') });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('PATCH', `/api/memory/${id}`, { archived: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/memory'] });
      toast({ title: t('strategy.memoryRestored') });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, type, content }: { id: number; type: string; content: string }) => {
      const res = await apiRequest('PATCH', `/api/memory/${id}`, { type, content });
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/memory'] });
      toast({ title: t('strategy.memoryUpdated') });
    },
    onError: () => toast({ title: t('strategy.failedToUpdateMemory'), variant: "destructive" }),
  });

  const startEdit = (mem: BusinessMemory) => {
    setEditingId(mem.id);
    setEditContent(mem.content);
    setEditType(mem.type);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditType('');
  };

  const saveEdit = () => {
    if (!editingId || !editContent.trim()) return;
    editMutation.mutate({ id: editingId, type: editType, content: editContent.trim() });
  };

  const handleSubmit = () => {
    if (!newContent.trim()) return;
    createMutation.mutate({ type: newType, content: newContent.trim() });
  };

  const typeConfig = (type: string) => MEMORY_TYPES.find(t => t.value === type) || MEMORY_TYPES[4];

  return (
    <Card className="dark:bg-gray-900 dark:border-gray-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            {t('strategy.businessMemory')}
          </CardTitle>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
          >
            {showArchived ? t('strategy.hideArchived') : t('strategy.showArchived')}
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">
          {t('strategy.memoryDescription')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_TYPES.map(mt => (
                  <SelectItem key={mt.value} value={mt.value}>
                    <span className="flex items-center gap-1.5">
                      <span>{mt.icon}</span>
                      <span>{t(`strategy.memoryTypes.${mt.value}`)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder={t('strategy.memoryPlaceholder')}
              className="flex-1 min-h-[36px] max-h-[80px] text-sm resize-none py-2"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!newContent.trim() || createMutation.isPending}
              className="self-start"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-14 bg-slate-100 dark:bg-gray-800 rounded animate-pulse" />)}
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-6">
            <BookOpen className="h-8 w-8 text-slate-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-gray-400">{t('strategy.noMemoriesYet')}</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">
              {t('strategy.recordDecisions')}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {memories.map((mem: BusinessMemory) => {
              const cfg = typeConfig(mem.type);
              const isEditing = editingId === mem.id;
              return (
                <div
                  key={mem.id}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border transition-colors ${
                    mem.archived
                      ? 'bg-slate-50/50 dark:bg-gray-800/30 border-slate-200/50 dark:border-gray-700/50 opacity-60'
                      : 'bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <Select value={editType} onValueChange={setEditType}>
                          <SelectTrigger className="w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MEMORY_TYPES.map(mt => (
                              <SelectItem key={mt.value} value={mt.value}>
                                <span className="flex items-center gap-1.5">
                                  <span>{mt.icon}</span>
                                  <span>{t(`strategy.memoryTypes.${mt.value}`)}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        className="min-h-[60px] text-sm resize-none"
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit();
                          }
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit} disabled={editMutation.isPending} className="h-7 text-xs">
                          {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common.save')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-xs">{t('common.cancel')}</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm flex-shrink-0 mt-0.5">{cfg.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 dark:text-gray-300">{mem.content}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.color}`}>
                            {t(`strategy.memoryTypes.${mem.type}`)}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-gray-500">
                            {new Date(mem.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                        {!mem.archived && (
                          <button
                            onClick={() => startEdit(mem)}
                            className="text-slate-300 hover:text-primary dark:text-gray-600 dark:hover:text-primary transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {mem.archived ? (
                          <button
                            onClick={() => restoreMutation.mutate(mem.id)}
                            className="text-slate-300 hover:text-primary dark:text-gray-600 dark:hover:text-primary transition-colors"
                            title="Restore"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => archiveMutation.mutate(mem.id)}
                            className="text-slate-300 hover:text-amber-500 dark:text-gray-600 dark:hover:text-amber-400 transition-colors"
                            title="Archive"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TriggerCard({
  trigger,
  isExpanded,
  isEditing,
  editText,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditTextChange,
  onDismiss,
  onDelete,
}: {
  trigger: MilestoneTrigger;
  isExpanded: boolean;
  isEditing: boolean;
  editText: string;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditTextChange: (v: string) => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tasksToUnlock = (trigger.tasksToUnlock as UnlockedTask[]) || [];
  const isTriggered = trigger.status === 'triggered';
  const isDismissed = trigger.status === 'dismissed';

  return (
    <Card className={`dark:bg-gray-900 dark:border-gray-700 ${isDismissed ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex gap-2 items-center">
                <input
                  value={editText}
                  onChange={e => onEditTextChange(e.target.value)}
                  className="flex-1 text-sm border border-slate-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-slate-900 dark:text-white"
                  onKeyDown={e => e.key === 'Enter' && onSaveEdit()}
                />
                <Button size="sm" variant="ghost" onClick={onSaveEdit}>{t('common.save')}</Button>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}><X className="h-3 w-3" /></Button>
              </div>
            ) : (
              <p className="text-sm text-slate-900 dark:text-white">
                {trigger.conditionSummary || trigger.rawCondition}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={isTriggered ? "default" : isDismissed ? "secondary" : "outline"} className={
                isTriggered
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0"
                  : isDismissed
                    ? "bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-500"
                    : "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
              }>
                {isTriggered ? t('strategy.triggered') : isDismissed ? t('strategy.dismissed') : t('strategy.watching')}
              </Badge>
              {tasksToUnlock.length > 0 && (
                <span className="text-[11px] text-slate-500 dark:text-gray-400">
                  {t('strategy.tasksToUnlockCount', { count: tasksToUnlock.length })}
                </span>
              )}
              {trigger.conditionType && trigger.conditionType !== 'keyword' && (
                <span className="text-[11px] text-slate-400 dark:text-gray-500 capitalize">
                  {trigger.conditionType}
                </span>
              )}
              {isTriggered && trigger.triggeredAt && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(trigger.triggeredAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {tasksToUnlock.length > 0 && (
              <Button size="sm" variant="ghost" onClick={onToggleExpand} className="h-7 w-7 p-0">
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            )}
            {!isTriggered && !isDismissed && (
              <>
                <Button size="sm" variant="ghost" onClick={onStartEdit} className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700">
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={onDismiss} className="h-7 w-7 p-0 text-slate-400 hover:text-amber-600">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-slate-400 hover:text-red-500">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {isExpanded && tasksToUnlock.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-gray-700 space-y-2">
            <p className="text-[11px] text-slate-500 dark:text-gray-400 uppercase tracking-wide">
              {t('strategy.tasksToUnlockHeader')}
            </p>
            {tasksToUnlock.map((task, i) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-gray-800 rounded-lg">
                <span className="text-xs mt-0.5 text-slate-400">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 dark:text-gray-300">{task.title}</p>
                  {task.description && (
                    <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {task.type && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400">{task.type}</span>
                    )}
                    {task.estimatedDuration && (
                      <span className="text-[10px] text-slate-400">{task.estimatedDuration}min</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
