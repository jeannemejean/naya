import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import Sidebar from "@/components/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle2, FileText, Rocket, Layers, Compass, BarChart3
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import type { Project } from "@shared/schema";

interface AnalyticsProps {
  onSearchClick?: () => void;
}

interface WeeklyPlan {
  contentStrategy?: string;
  outreachStrategy?: string;
  metrics?: string;
}

interface ProjectSummary {
  tasks: {
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
    byEnergy: Record<string, number>;
    byType: Record<string, number>;
  };
  content: {
    total: number;
    byStatus: { idea: number; draft: number; ready: number; published: number };
    byPlatform: Record<string, number>;
  };
  campaigns: {
    active: number;
    completed: number;
    draft: number;
    totalTasksGenerated: number;
  };
  strategy: {
    focus: string;
    recommendations: string[];
    weeklyPlan: WeeklyPlan;
  } | null;
  weeklyCompletion: Array<{ week: string; completed: number; total: number }>;
}

const PIPELINE_COLORS: Record<string, string> = {
  idea: "bg-amber-400",
  draft: "bg-blue-400",
  ready: "bg-green-400",
  published: "bg-violet-500",
};

const PIPELINE_LABELS: Record<string, string> = {
  idea: "Idea",
  draft: "Draft",
  ready: "Ready",
  published: "Published",
};

const INSIGHT_COLORS = ["bg-indigo-400", "bg-violet-400", "bg-cyan-400", "bg-emerald-400"];

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <Card className={`dark:bg-gray-900 dark:border-gray-700 ${className}`}>
      <CardContent className="p-5">
        <div className="h-4 w-20 bg-slate-200 dark:bg-gray-700 rounded animate-pulse mb-3" />
        <div className="h-8 w-24 bg-slate-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
        <div className="h-3 w-16 bg-slate-100 dark:bg-gray-800 rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

export default function Analytics({ onSearchClick }: AnalyticsProps) {
  const { t } = useTranslation();
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      const primary = projects.find((p) => p.isPrimary) || projects[0];
      setSelectedProjectId(primary.id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const { data, isLoading } = useQuery<ProjectSummary>({
    queryKey: ["/api/analytics/project-summary", selectedProjectId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/project-summary?projectId=${selectedProjectId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedProjectId,
  });

  const isAllZero = data &&
    data.tasks.total === 0 &&
    data.content.total === 0 &&
    data.campaigns.active === 0 &&
    data.campaigns.completed === 0 &&
    data.campaigns.draft === 0;

  const taskTypeData = data
    ? Object.entries(data.tasks.byType).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('analytics.title')}{selectedProject ? ` — ${selectedProject.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('analytics.subtitle')}
          </p>

          {projects.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {projects.slice(0, 5).map((p) => (
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

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <SkeletonCard className="lg:col-span-3" />
                <SkeletonCard className="lg:col-span-2" />
              </div>
            </>
          ) : isAllZero ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <BarChart3 className="h-12 w-12 text-slate-300 dark:text-gray-600 mb-4" />
              <p className="text-lg text-slate-900 dark:text-white mb-1">
                {t('analytics.noData')} — {selectedProject?.name || ""}
              </p>
              <p className="text-sm text-slate-500 dark:text-gray-400 max-w-md">
                {t('analytics.selectProject')}
              </p>
            </div>
          ) : data ? (
            <>
              {/* Section 1 — KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl text-slate-900 dark:text-white">{data.tasks.completionRate}%</p>
                        <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">{t('analytics.tasksCompleted')}</p>
                      </div>
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg">
                        <CheckCircle2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mt-2">{data.tasks.completed} of {data.tasks.total}</p>
                  </CardContent>
                </Card>

                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl text-slate-900 dark:text-white">{data.content.byStatus.published}</p>
                        <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">{t('analytics.contentPieces')}</p>
                      </div>
                      <div className="p-2 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
                        <FileText className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl text-slate-900 dark:text-white">{data.campaigns.active}</p>
                        <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">{t('analytics.activeCampaigns')}</p>
                      </div>
                      <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
                        <Rocket className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl text-slate-900 dark:text-white">{data.content.total}</p>
                        <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">{t('analytics.contentPipeline')}</p>
                      </div>
                      <div className="p-2 bg-cyan-100 dark:bg-cyan-900/40 rounded-lg">
                        <Layers className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Section 2 — Weekly Execution + Content Pipeline */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <Card className="lg:col-span-3 dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3">
                      {t('analytics.weeklyCompletion')}
                    </p>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.weeklyCompletion}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="week" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={30} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "var(--tooltip-bg, #fff)",
                              border: "1px solid #e2e8f0",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                          />
                          <Area type="monotone" dataKey="total" stroke="#94a3b8" strokeDasharray="5 5" fill="#f1f5f9" fillOpacity={0.3} name="Total" />
                          <Area type="monotone" dataKey="completed" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} name="Completed" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2 dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3">
                      {t('analytics.contentPipeline')}
                    </p>
                    <div className="space-y-3">
                      {(["idea", "draft", "ready", "published"] as const).map((status) => {
                        const count = data.content.byStatus[status];
                        const max = Math.max(
                          data.content.byStatus.idea,
                          data.content.byStatus.draft,
                          data.content.byStatus.ready,
                          data.content.byStatus.published,
                          1
                        );
                        const pct = Math.round((count / max) * 100);
                        return (
                          <div key={status} className="flex items-center gap-3">
                            <span className="text-xs text-slate-600 dark:text-gray-400 w-16">{PIPELINE_LABELS[status]}</span>
                            <div className="flex-1 h-5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${PIPELINE_COLORS[status]}`}
                                style={{ width: `${pct}%`, minWidth: count > 0 ? "8px" : "0" }}
                              />
                            </div>
                            <span className="text-xs text-slate-700 dark:text-gray-300 w-6 text-right">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Section 3 — Tasks by type + Campaigns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3">
                      {t('analytics.taskDistribution')}
                    </p>
                    {taskTypeData.length > 0 ? (
                      <div className="h-[160px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={taskTypeData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "var(--tooltip-bg, #fff)",
                                border: "1px solid #e2e8f0",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                            />
                            <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} name="Tasks" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 dark:text-gray-500 py-8 text-center">{t('analytics.noData')}</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <CardContent className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3">
                      {t('campaigns.title')}
                    </p>
                    {data.campaigns.active === 0 && data.campaigns.completed === 0 && data.campaigns.draft === 0 ? (
                      <p className="text-sm text-slate-400 dark:text-gray-500 py-8 text-center">
                        {t('campaigns.noCampaigns')}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                          <span className="text-sm text-slate-700 dark:text-gray-300 flex-1">{t('campaigns.active')}</span>
                          <span className="text-sm text-slate-900 dark:text-white">{data.campaigns.active}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                          <span className="text-sm text-slate-700 dark:text-gray-300 flex-1">{t('campaigns.completed')}</span>
                          <span className="text-sm text-slate-900 dark:text-white">{data.campaigns.completed}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-gray-600" />
                          <span className="text-sm text-slate-700 dark:text-gray-300 flex-1">{t('campaigns.draft')}</span>
                          <span className="text-sm text-slate-900 dark:text-white">{data.campaigns.draft}</span>
                        </div>
                        <p className="text-xs text-slate-400 dark:text-gray-500 pt-2 border-t border-slate-100 dark:border-gray-800">
                          Total tasks generated by campaigns: {data.campaigns.totalTasksGenerated}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Section 4 — Strategy this week */}
              {data.strategy ? (
                <Card className="dark:bg-gray-900 dark:border-gray-700 border-l-4 border-l-indigo-400 dark:border-l-indigo-600">
                  <CardContent className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">
                      {t('analytics.strategicFocus')}
                    </p>
                    <p className="text-lg text-slate-900 dark:text-white mb-3">
                      {data.strategy.focus}
                    </p>

                    {data.strategy.recommendations && data.strategy.recommendations.length > 0 && (
                      <div className="space-y-2 mb-4">
                        {data.strategy.recommendations.map((rec, i) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${INSIGHT_COLORS[i % INSIGHT_COLORS.length]}`} />
                            <p className="text-sm text-slate-700 dark:text-gray-300">{rec}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {data.strategy.weeklyPlan && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-gray-800">
                        {data.strategy.weeklyPlan.contentStrategy && (
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-slate-600 dark:text-gray-400">Content</span>
                              <p className="text-xs text-slate-700 dark:text-gray-300 mt-0.5">{data.strategy.weeklyPlan.contentStrategy}</p>
                            </div>
                          </div>
                        )}
                        {data.strategy.weeklyPlan.outreachStrategy && (
                          <div className="flex items-start gap-2">
                            <Compass className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-slate-600 dark:text-gray-400">Outreach</span>
                              <p className="text-xs text-slate-700 dark:text-gray-300 mt-0.5">{data.strategy.weeklyPlan.outreachStrategy}</p>
                            </div>
                          </div>
                        )}
                        {data.strategy.weeklyPlan.metrics && (
                          <div className="flex items-start gap-2">
                            <BarChart3 className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-slate-600 dark:text-gray-400">Watch</span>
                              <p className="text-xs text-slate-700 dark:text-gray-300 mt-0.5">{data.strategy.weeklyPlan.metrics}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card className="dark:bg-gray-900 dark:border-gray-700 border-2 border-dashed">
                  <CardContent className="p-6 text-center">
                    <Compass className="h-8 w-8 text-slate-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-500 dark:text-gray-400">
                      {t('analytics.noData')} —{" "}
                      <Link href="/strategy" className="text-primary hover:underline">
                        {t('strategy.generateBrief')}
                      </Link>
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
