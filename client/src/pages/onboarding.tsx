import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

// ─── Types ───────────────────────────────────────────────────────────────────

interface OperatingProfile {
  energyRhythm: string;
  planningStyle: string;
  activationStyle: string;
  encouragementStyle: string;
  avoidanceTriggers: string[];
  selfDescribedFriction: string;
}

interface PrimaryProject {
  name: string;
  website: string;
  linkedinProfile: string;
  instagramHandle: string;
  businessType: string;
  businessModel: string;
  revenueUrgency: string;
  targetAudience: string;
  corePainPoint: string;
  audienceAspiration: string;
  authorityLevel: string;
  communicationStyle: string;
  uniquePositioning: string;
  platformPriority: string;
  currentPresence: string;
  // Step 7 — Offers & Pricing
  offers: string;
  priceRange: string;
  clientJourney: string;
  // Step 8 — Voice & Differentiation
  brandVoiceKeywords: string[];
  brandVoiceAntiKeywords: string[];
  editorialTerritory: string;
  competitorLandscape: string;
  // Goals
  primaryGoal: string;
  contentBandwidth: string;
  successDefinition: string;
  currentChallenges: string;
  pastSuccess: string;
  inspiration: string;
  initialGoalTitle: string;
  initialGoalType: string;
  initialGoalTimeframe: string;
  initialGoalTarget: string;
}

interface AdditionalProject {
  id: string;
  name: string;
  type: string;
  intent: string;
  description: string;
  goalTitle: string;
  goalTimeframe: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 12;

function getLayerConfig(t: (key: string) => string) {
  return [
    { layer: 1, label: t('onboarding.layers.you'), steps: [2, 3], color: "bg-violet-500" },
    { layer: 2, label: t('onboarding.layers.yourWork'), steps: [4, 5, 6, 7, 8, 9, 10], color: "bg-primary" },
    { layer: 3, label: t('onboarding.layers.everythingElse'), steps: [11, 12], color: "bg-emerald-500" },
  ];
}

function getLayerForStep(step: number, layerConfig: ReturnType<typeof getLayerConfig>) {
  return layerConfig.find(l => l.steps.includes(step)) || layerConfig[0];
}

function getAvoidanceOptions(t: (key: string) => string) {
  return [
    { value: "visibility", label: t('onboarding.avoidanceOptions.visibility') },
    { value: "selling", label: t('onboarding.avoidanceOptions.selling') },
    { value: "starting", label: t('onboarding.avoidanceOptions.starting') },
    { value: "admin-tasks", label: t('onboarding.avoidanceOptions.adminTasks') },
    { value: "perfectionism", label: t('onboarding.avoidanceOptions.perfectionism') },
    { value: "repetitive", label: t('onboarding.avoidanceOptions.repetitive') },
    { value: "asking-for-help", label: t('onboarding.avoidanceOptions.askingForHelp') },
    { value: "wellbeing-routines", label: t('onboarding.avoidanceOptions.wellbeingRoutines') },
  ];
}

function getProjectTypeOptions(t: (key: string) => string) {
  return [
    { value: "Business", label: t('onboarding.projectTypeOptions.business'), icon: "💼" },
    { value: "Personal Brand", label: t('onboarding.projectTypeOptions.personalBrand'), icon: "✨" },
    { value: "Creative", label: t('onboarding.projectTypeOptions.creative'), icon: "🎨" },
    { value: "Learning", label: t('onboarding.projectTypeOptions.learning'), icon: "📚" },
    { value: "Lifestyle", label: t('onboarding.projectTypeOptions.lifestyle'), icon: "🌿" },
    { value: "Life / Routine", label: t('onboarding.projectTypeOptions.lifeRoutine'), icon: "🔄" },
    { value: "Personal", label: t('onboarding.projectTypeOptions.personal'), icon: "🙏" },
  ];
}

function getIntentOptions(t: (key: string) => string) {
  return [
    { value: "revenue", label: t('onboarding.intentOptions.revenue') },
    { value: "exploration", label: t('onboarding.intentOptions.exploration') },
    { value: "personal-growth", label: t('onboarding.intentOptions.personalGrowth') },
    { value: "creative-expression", label: t('onboarding.intentOptions.creativeExpression') },
    { value: "lifestyle", label: t('onboarding.intentOptions.lifestyle') },
    { value: "wellbeing", label: t('onboarding.intentOptions.wellbeing') },
  ];
}

const TYPE_ICON: Record<string, string> = {
  "Business": "💼", "Personal Brand": "✨", "Creative": "🎨",
  "Learning": "📚", "Lifestyle": "🌿", "Life / Routine": "🔄", "Personal": "🙏",
};

// ─── BoardGeneratingScreen ────────────────────────────────────────────────────

function BoardGeneratingScreen() {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);

  const generationSteps = [
    { label: t('onboarding.boardGenerating.savingProfile'), icon: "📝" },
    { label: t('onboarding.boardGenerating.creatingProjects'), icon: "📁" },
    { label: t('onboarding.boardGenerating.settingUpCoPilot'), icon: "🤖" },
  ];

  useEffect(() => {
    const stepDuration = 900;
    const totalDuration = stepDuration * 3;
    let start: number | null = null;
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const pct = Math.min((elapsed / totalDuration) * 100, 99);
      setProgress(pct);
      const step = Math.min(Math.floor(elapsed / stepDuration), 2);
      setActiveStep(step);
      if (elapsed < totalDuration) requestAnimationFrame(animate);
    };
    const raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-10 pb-10 text-center space-y-8">
          <div className="flex items-center justify-center space-x-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <span className="text-white text-base">N</span>
            </div>
            <span className="text-2xl text-slate-900">Naya</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl text-slate-900">{t('onboarding.boardGenerating.title')}</h2>
            <p className="text-sm text-slate-500">{t('onboarding.boardGenerating.subtitle')}</p>
          </div>
          <div className="space-y-3 text-left">
            {generationSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                  i < activeStep ? 'bg-emerald-500 text-white' : i === activeStep ? 'bg-primary text-white' : 'bg-slate-100 text-slate-300'
                }`}>
                  {i < activeStep ? <CheckCircle2 className="h-3.5 w-3.5" /> : i === activeStep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-xs">{i + 1}</span>}
                </div>
                <span className={`text-sm transition-colors duration-300 ${i <= activeStep ? 'text-slate-900' : 'text-slate-400'}`}>
                  {step.icon} {step.label}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Progress value={progress} className="h-1.5" />
            <p className="text-xs text-slate-400">{t('onboarding.boardGenerating.complete', { percent: Math.round(progress) })}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Shared UI Components ─────────────────────────────────────────────────────

function SelectCard({ value, selected, onClick, icon, label }: {
  value: string; selected: boolean; onClick: () => void; icon?: string; label: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors text-sm ${
        selected ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-gray-700 dark:text-gray-300'
      }`}
    >
      {icon && <span className="text-base">{icon}</span>}
      <span>{label}</span>
      {selected && <div className="ml-auto w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0"><span className="text-white text-[10px]">✓</span></div>}
    </div>
  );
}

function CheckCard({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
        selected ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-gray-700 dark:text-gray-300'
      }`}
    >
      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${selected ? 'border-primary bg-primary' : 'border-slate-300 dark:border-gray-600'}`}>
        {selected && <span className="text-white text-[10px] leading-none">✓</span>}
      </div>
      {label}
    </div>
  );
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  const { t } = useTranslation();
  return (
    <label className="block text-base text-slate-900 dark:text-white mb-2 mt-1">
      {children}
      {optional && <span className="ml-1.5 text-xs text-slate-400 font-normal">{t('common.optional')}</span>}
    </label>
  );
}

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
    const kw = raw.trim().replace(/[^a-zA-Z0-9\-À-öø-ÿ ]/gi, '');
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
        <span
          key={kw}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20"
        >
          {kw}
          <button
            type="button"
            onClick={() => onChange(values.filter(v => v !== kw))}
            className="hover:text-red-400 transition-colors leading-none"
          >
            ×
          </button>
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

// ─── Main Onboarding Component ────────────────────────────────────────────────

export default function Onboarding() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [boardGenerating, setBoardGenerating] = useState(false);

  // Layer 1 state
  const [opProfile, setOpProfile] = useState<OperatingProfile>({
    energyRhythm: "", planningStyle: "", activationStyle: "",
    encouragementStyle: "", avoidanceTriggers: [], selfDescribedFriction: "",
  });

  // Layer 2 state
  const [primary, setPrimary] = useState<PrimaryProject>({
    name: "", website: "", linkedinProfile: "", instagramHandle: "",
    businessType: "", businessModel: "", revenueUrgency: "",
    targetAudience: "", corePainPoint: "", audienceAspiration: "",
    authorityLevel: "", communicationStyle: "", uniquePositioning: "",
    platformPriority: "", currentPresence: "",
    offers: "", priceRange: "", clientJourney: "",
    brandVoiceKeywords: [], brandVoiceAntiKeywords: [],
    editorialTerritory: "", competitorLandscape: "",
    primaryGoal: "", contentBandwidth: "", successDefinition: "",
    currentChallenges: "", pastSuccess: "", inspiration: "",
    initialGoalTitle: "", initialGoalType: "quarterly",
    initialGoalTimeframe: "", initialGoalTarget: "",
  });

  // Layer 3 state
  const [additionalProjects, setAdditionalProjects] = useState<AdditionalProject[]>([]);
  const [addingProject, setAddingProject] = useState(false);
  const [newProject, setNewProject] = useState<Omit<AdditionalProject, 'id'>>({
    name: "", type: "", intent: "", description: "", goalTitle: "", goalTimeframe: "",
  });
  const [showGoalInNewProject, setShowGoalInNewProject] = useState(false);

  const LAYER_CONFIG = getLayerConfig(t);
  const AVOIDANCE_OPTIONS = getAvoidanceOptions(t);
  const PROJECT_TYPE_OPTIONS = getProjectTypeOptions(t);
  const INTENT_OPTIONS = getIntentOptions(t);
  const currentLayer = getLayerForStep(step, LAYER_CONFIG);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding", {
        operatingProfile: opProfile,
        primaryProject: primary,
        additionalProjects,
      });
      return res.json();
    },
    onMutate: () => setBoardGenerating(true),
    onSuccess: () => {
      localStorage.removeItem('naya_active_project_id');
      // Fire-and-forget intelligence generation if enough core brand fields were filled
      const hasCoreBrandFields = !!(primary.businessType && primary.offers && primary.uniquePositioning && primary.platformPriority);
      if (hasCoreBrandFields) {
        apiRequest("POST", "/api/brand-dna/refresh-intelligence").catch(() => {});
      }
      setTimeout(() => { window.location.href = "/"; }, 2800);
    },
    onError: () => {
      setBoardGenerating(false);
      toast({ title: t('onboarding.setupFailed'), description: t('onboarding.setupFailedDescription'), variant: "destructive" });
    },
  });

  const next = () => setStep(s => Math.min(s + 1, TOTAL_STEPS));
  const back = () => setStep(s => Math.max(s - 1, 1));
  const skipToLayer2 = () => setStep(4);
  const skipToLayer3 = () => setStep(11);

  const setOp = (field: keyof OperatingProfile, value: any) =>
    setOpProfile(p => ({ ...p, [field]: value }));
  const toggleAvoidance = (v: string) =>
    setOpProfile(p => ({
      ...p,
      avoidanceTriggers: p.avoidanceTriggers.includes(v)
        ? p.avoidanceTriggers.filter(x => x !== v)
        : [...p.avoidanceTriggers, v],
    }));
  const setPri = (field: keyof PrimaryProject, value: string) =>
    setPrimary(p => ({ ...p, [field]: value }));

  const addAdditionalProject = () => {
    if (!newProject.name.trim()) return;
    setAdditionalProjects(prev => [
      ...prev,
      { ...newProject, name: newProject.name.trim(), id: Date.now().toString() },
    ]);
    setNewProject({ name: "", type: "", intent: "", description: "", goalTitle: "", goalTimeframe: "" });
    setShowGoalInNewProject(false);
    setAddingProject(false);
  };

  const removeAdditionalProject = (id: string) =>
    setAdditionalProjects(prev => prev.filter(p => p.id !== id));

  const canProceed = () => {
    if (step === 4) return primary.name.trim().length > 0;
    return true;
  };

  if (boardGenerating) return <BoardGeneratingScreen />;

  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {step > 1 && (
        <>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-white text-xs">N</span>
            </div>
            <span className="text-base text-slate-900 dark:text-white">Naya</span>
          </div>
          {/* Layer indicator */}
          <div className="flex items-center gap-1.5">
            {LAYER_CONFIG.map((l) => {
              const isActive = l.layer === currentLayer.layer;
              const isPast = l.layer < currentLayer.layer;
              return (
                <div
                  key={l.layer}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all ${
                    isActive ? `${l.color} text-white` :
                    isPast ? 'bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400' :
                    'bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500'
                  }`}
                >
                  {isPast && <CheckCircle2 className="h-3 w-3" />}
                  {l.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <Progress value={progress} className="h-1" />
        </div>
        </>
        )}

        <Card className="dark:bg-gray-900 dark:border-gray-700">
          <CardContent className={step === 1 ? "p-8 sm:p-12 text-center space-y-6" : "p-6 sm:p-8"}>

            {/* ─── STEP 1: WELCOME SCREEN ─── */}
            {step === 1 && (
              <div className="space-y-6 flex flex-col items-center">
                <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto">
                  <span className="text-white text-2xl">N</span>
                </div>
                <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.welcome.greeting')}</h2>
                <div className="max-w-md mx-auto space-y-4 text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                  <p>{t('onboarding.welcome.intro1')}</p>
                  <p>{t('onboarding.welcome.intro2')}</p>
                  <p className="font-medium text-slate-800 dark:text-gray-200">{t('onboarding.welcome.intro3')}</p>
                </div>
                <Button onClick={next} className="px-8 py-5 text-base">
                  {t('onboarding.welcome.letsBegin')} <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {/* ─── LAYER 1: STEP 2 ─── How You Work (part 1) */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.howYouWork')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.howYouWorkDescription')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel>{t('onboarding.bestWorkTime')}</FieldLabel>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { value: "morning-person", label: t('onboarding.morningPerson') },
                        { value: "afternoon-peak", label: t('onboarding.afternoonPeak') },
                        { value: "evening-owl", label: t('onboarding.eveningOwl') },
                        { value: "variable", label: t('onboarding.variable') },
                      ].map(o => (
                        <SelectCard key={o.value} value={o.value} selected={opProfile.energyRhythm === o.value}
                          onClick={() => setOp('energyRhythm', o.value)} label={o.label} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>{t('onboarding.planningStyle')}</FieldLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { value: "visual", label: t('onboarding.visual') },
                        { value: "list", label: t('onboarding.listBased') },
                        { value: "time-blocked", label: t('onboarding.timeBlocked') },
                        { value: "flexible", label: t('onboarding.flexible') },
                        { value: "spontaneous", label: t('onboarding.spontaneous') },
                      ].map(o => (
                        <SelectCard key={o.value} value={o.value} selected={opProfile.planningStyle === o.value}
                          onClick={() => setOp('planningStyle', o.value)} label={o.label} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>{t('onboarding.activationStyle')}</FieldLabel>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { value: "smallest-next-step", label: t('onboarding.smallestStep') },
                        { value: "big-picture-first", label: t('onboarding.bigPicture') },
                        { value: "deadline-pressure", label: t('onboarding.deadlinePressure') },
                        { value: "external-accountability", label: t('onboarding.externalAccountability') },
                      ].map(o => (
                        <SelectCard key={o.value} value={o.value} selected={opProfile.activationStyle === o.value}
                          onClick={() => setOp('activationStyle', o.value)} label={o.label} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>{t('onboarding.encouragementStyle')}</FieldLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { value: "direct-and-brief", label: t('onboarding.directBrief') },
                        { value: "warm-and-supportive", label: t('onboarding.warmSupportive') },
                        { value: "structured-framework", label: t('onboarding.structuredFramework') },
                        { value: "reframe-and-question", label: t('onboarding.reframeQuestion') },
                      ].map(o => (
                        <SelectCard key={o.value} value={o.value} selected={opProfile.encouragementStyle === o.value}
                          onClick={() => setOp('encouragementStyle', o.value)} label={o.label} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 1: STEP 3 ─── How You Work (part 2) */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.howYouWork')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.frictionSectionDesc')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel optional>{t('onboarding.avoidanceQuestion')}</FieldLabel>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mb-2">{t('onboarding.selectAllThatApply')}</p>
                    <div className="grid grid-cols-1 gap-2">
                      {AVOIDANCE_OPTIONS.map(o => (
                        <CheckCard key={o.value} selected={opProfile.avoidanceTriggers.includes(o.value)}
                          onClick={() => toggleAvoidance(o.value)} label={o.label} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.frictionDetailQuestion')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.frictionDetailPlaceholder')}
                      rows={3}
                      value={opProfile.selfDescribedFriction}
                      onChange={e => setOp('selfDescribedFriction', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 4 ─── Project Identification */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.mainWorkTitle')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.mainWorkDescription')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel>{t('onboarding.projectNameQuestion')}</FieldLabel>
                    <Input
                      placeholder={t('onboarding.projectNamePlaceholderAlt')}
                      value={primary.name}
                      onChange={e => setPri('name', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                      autoFocus
                    />
                    {!primary.name.trim() && <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">{t('onboarding.onlyRequiredField')}</p>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <FieldLabel optional>{t('onboarding.website')}</FieldLabel>
                      <Input placeholder={t('onboarding.websitePlaceholder')} value={primary.website} onChange={e => setPri('website', e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                    </div>
                    <div>
                      <FieldLabel optional>{t('onboarding.linkedin')}</FieldLabel>
                      <Input placeholder={t('onboarding.linkedinPlaceholder')} value={primary.linkedinProfile} onChange={e => setPri('linkedinProfile', e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                    </div>
                    <div>
                      <FieldLabel optional>{t('onboarding.instagram')}</FieldLabel>
                      <Input placeholder={t('onboarding.instagramPlaceholder')} value={primary.instagramHandle} onChange={e => setPri('instagramHandle', e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 5 ─── Business Type + First Goal */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step5Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step5Description')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel>{t('onboarding.whatDescribesWork')}</FieldLabel>
                    <Select value={primary.businessType} onValueChange={v => setPri('businessType', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseWorkType')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="independent-professional">{t('onboarding.businessTypeSelectOptions.independentProfessional')}</SelectItem>
                        <SelectItem value="service-business">{t('onboarding.businessTypeSelectOptions.serviceBusiness')}</SelectItem>
                        <SelectItem value="creator-personal-brand">{t('onboarding.businessTypeSelectOptions.creatorPersonalBrand')}</SelectItem>
                        <SelectItem value="coaching-education">{t('onboarding.businessTypeSelectOptions.coachingEducation')}</SelectItem>
                        <SelectItem value="product-startup">{t('onboarding.businessTypeSelectOptions.productStartup')}</SelectItem>
                        <SelectItem value="maker-craftsperson">{t('onboarding.businessTypeSelectOptions.makerCraftsperson')}</SelectItem>
                        <SelectItem value="researcher-writer">{t('onboarding.businessTypeSelectOptions.researcherWriter')}</SelectItem>
                        <SelectItem value="other">{t('onboarding.businessTypeSelectOptions.other')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel>{t('onboarding.howCreateValue')}</FieldLabel>
                    <Select value={primary.businessModel} onValueChange={v => setPri('businessModel', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseModel')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="client-services">{t('onboarding.businessModelSelectOptions.clientServices')}</SelectItem>
                        <SelectItem value="productized-services">{t('onboarding.businessModelSelectOptions.productizedServices')}</SelectItem>
                        <SelectItem value="digital-products">{t('onboarding.businessModelSelectOptions.digitalProducts')}</SelectItem>
                        <SelectItem value="courses-programs">{t('onboarding.businessModelSelectOptions.coursesPrograms')}</SelectItem>
                        <SelectItem value="coaching-consulting">{t('onboarding.businessModelSelectOptions.coachingConsulting')}</SelectItem>
                        <SelectItem value="content-media">{t('onboarding.businessModelSelectOptions.contentMedia')}</SelectItem>
                        <SelectItem value="saas-software">{t('onboarding.businessModelSelectOptions.saasSoftware')}</SelectItem>
                        <SelectItem value="physical-product">{t('onboarding.businessModelSelectOptions.physicalProduct')}</SelectItem>
                        <SelectItem value="hybrid">{t('onboarding.businessModelSelectOptions.hybrid')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel>{t('onboarding.currentRevenueSituation')}</FieldLabel>
                    <Select value={primary.revenueUrgency} onValueChange={v => setPri('revenueUrgency', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseSituation')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="just-starting">{t('onboarding.revenueStatusOptions.justStarting')}</SelectItem>
                        <SelectItem value="first-clients">{t('onboarding.revenueStatusOptions.firstClients')}</SelectItem>
                        <SelectItem value="growing-steadily">{t('onboarding.revenueStatusOptions.growingSteadily')}</SelectItem>
                        <SelectItem value="scaling-up">{t('onboarding.revenueStatusOptions.scalingUp')}</SelectItem>
                        <SelectItem value="stable-optimizing">{t('onboarding.revenueStatusOptions.stableOptimizing')}</SelectItem>
                        <SelectItem value="pivoting">{t('onboarding.revenueStatusOptions.pivoting')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Optional first goal */}
                  <div className="border border-slate-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
                    <div>
                      <p className="text-sm text-slate-900 dark:text-white">{t('onboarding.achieveQuestion')}</p>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{t('onboarding.achieveOptional')}</p>
                    </div>
                    <div>
                      <FieldLabel optional>{t('onboarding.goalTitle')}</FieldLabel>
                      <Input
                        placeholder={t('onboarding.goalPlaceholderAlt')}
                        value={primary.initialGoalTitle}
                        onChange={e => setPri('initialGoalTitle', e.target.value)}
                        className="dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    {primary.initialGoalTitle && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel optional>{t('onboarding.goalTimeframe')}</FieldLabel>
                          <Input placeholder={t('onboarding.timeframePlaceholderAlt')} value={primary.initialGoalTimeframe} onChange={e => setPri('initialGoalTimeframe', e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                        <div>
                          <FieldLabel optional>{t('onboarding.goalTarget')}</FieldLabel>
                          <Input placeholder={t('onboarding.targetPlaceholderAlt')} value={primary.initialGoalTarget} onChange={e => setPri('initialGoalTarget', e.target.value)} className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 6 ─── Audience */}
            {step === 6 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step6Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step6Description')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel optional>{t('onboarding.primaryAudienceQuestion')}</FieldLabel>
                    <Select value={primary.targetAudience} onValueChange={v => setPri('targetAudience', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseAudience')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="independent-professionals">{t('onboarding.audienceSelectOptions.independentProfessionals')}</SelectItem>
                        <SelectItem value="small-business-owners">{t('onboarding.audienceSelectOptions.smallBusinessOwners')}</SelectItem>
                        <SelectItem value="entrepreneurs-founders">{t('onboarding.audienceSelectOptions.entrepreneursFounders')}</SelectItem>
                        <SelectItem value="creators-makers">{t('onboarding.audienceSelectOptions.creatorsMakers')}</SelectItem>
                        <SelectItem value="coaches-consultants">{t('onboarding.audienceSelectOptions.coachesConsultants')}</SelectItem>
                        <SelectItem value="corporate-professionals">{t('onboarding.audienceSelectOptions.corporateProfessionals')}</SelectItem>
                        <SelectItem value="general-consumers">{t('onboarding.audienceSelectOptions.generalConsumers')}</SelectItem>
                        <SelectItem value="niche-community">{t('onboarding.audienceSelectOptions.nicheCommunity')}</SelectItem>
                        <SelectItem value="no-audience-yet">{t('onboarding.audienceSelectOptions.noAudienceYet')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.mainFrustration')}</FieldLabel>
                    <Select value={primary.corePainPoint} onValueChange={v => setPri('corePainPoint', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseCoreChallenge')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not-enough-clients">{t('onboarding.painPointSelectOptions.notEnoughClients')}</SelectItem>
                        <SelectItem value="inconsistent-revenue">{t('onboarding.painPointSelectOptions.inconsistentRevenue')}</SelectItem>
                        <SelectItem value="lack-of-visibility">{t('onboarding.painPointSelectOptions.lackOfVisibility')}</SelectItem>
                        <SelectItem value="too-much-to-do">{t('onboarding.painPointSelectOptions.tooMuchToDo')}</SelectItem>
                        <SelectItem value="no-clear-direction">{t('onboarding.painPointSelectOptions.noClearDirection')}</SelectItem>
                        <SelectItem value="imposter-syndrome">{t('onboarding.painPointSelectOptions.imposterSyndrome')}</SelectItem>
                        <SelectItem value="stuck-in-execution">{t('onboarding.painPointSelectOptions.stuckInExecution')}</SelectItem>
                        <SelectItem value="scaling-problems">{t('onboarding.painPointSelectOptions.scalingProblems')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.aspirationQuestion')}</FieldLabel>
                    <Select value={primary.audienceAspiration} onValueChange={v => setPri('audienceAspiration', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseAspiration')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="financial-freedom">{t('onboarding.aspirationSelectOptions.financialFreedom')}</SelectItem>
                        <SelectItem value="recognition-authority">{t('onboarding.aspirationSelectOptions.recognitionAuthority')}</SelectItem>
                        <SelectItem value="impact-at-scale">{t('onboarding.aspirationSelectOptions.impactAtScale')}</SelectItem>
                        <SelectItem value="time-freedom">{t('onboarding.aspirationSelectOptions.timeFreedom')}</SelectItem>
                        <SelectItem value="build-something-lasting">{t('onboarding.aspirationSelectOptions.buildSomethingLasting')}</SelectItem>
                        <SelectItem value="creative-fulfillment">{t('onboarding.aspirationSelectOptions.creativeFulfillment')}</SelectItem>
                        <SelectItem value="community-belonging">{t('onboarding.aspirationSelectOptions.communityBelonging')}</SelectItem>
                        <SelectItem value="career-growth">{t('onboarding.aspirationSelectOptions.careerGrowth')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 7 ─── Voice & Platform */}
            {step === 7 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step7Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step7Description')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel optional>{t('onboarding.communicationStyleQuestion')}</FieldLabel>
                    <Select value={primary.communicationStyle} onValueChange={v => setPri('communicationStyle', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseStylePlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct-practical">{t('onboarding.communicationStyleSelectOptions.directPractical')}</SelectItem>
                        <SelectItem value="warm-personal">{t('onboarding.communicationStyleSelectOptions.warmPersonal')}</SelectItem>
                        <SelectItem value="expert-authoritative">{t('onboarding.communicationStyleSelectOptions.expertAuthoritative')}</SelectItem>
                        <SelectItem value="creative-expressive">{t('onboarding.communicationStyleSelectOptions.creativeExpressive')}</SelectItem>
                        <SelectItem value="thoughtful-nuanced">{t('onboarding.communicationStyleSelectOptions.thoughtfulNuanced')}</SelectItem>
                        <SelectItem value="energetic-motivating">{t('onboarding.communicationStyleSelectOptions.energeticMotivating')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.uniqueApproachQuestion')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.uniqueApproachPlaceholder')}
                      rows={3}
                      value={primary.uniquePositioning}
                      onChange={e => setPri('uniquePositioning', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.audienceConnectionQuestion')}</FieldLabel>
                    <Select value={primary.platformPriority} onValueChange={v => setPri('platformPriority', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.choosePlatformPlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="linkedin">{t('onboarding.platformSelectOptions.linkedin')}</SelectItem>
                        <SelectItem value="instagram">{t('onboarding.platformSelectOptions.instagram')}</SelectItem>
                        <SelectItem value="twitter-x">{t('onboarding.platformSelectOptions.twitterX')}</SelectItem>
                        <SelectItem value="newsletter">{t('onboarding.platformSelectOptions.newsletter')}</SelectItem>
                        <SelectItem value="youtube">{t('onboarding.platformSelectOptions.youtube')}</SelectItem>
                        <SelectItem value="tiktok">{t('onboarding.platformSelectOptions.tiktok')}</SelectItem>
                        <SelectItem value="podcast">{t('onboarding.platformSelectOptions.podcast')}</SelectItem>
                        <SelectItem value="website-blog">{t('onboarding.platformSelectOptions.websiteBlog')}</SelectItem>
                        <SelectItem value="no-platform-yet">{t('onboarding.platformSelectOptions.noPlatformYet')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.currentPresenceQuestion')}</FieldLabel>
                    <Select value={primary.currentPresence} onValueChange={v => setPri('currentPresence', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.choosePresencePlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not-started">{t('onboarding.presenceSelectOptions.notStarted')}</SelectItem>
                        <SelectItem value="minimal-inconsistent">{t('onboarding.presenceSelectOptions.minimalInconsistent')}</SelectItem>
                        <SelectItem value="building-momentum">{t('onboarding.presenceSelectOptions.buildingMomentum')}</SelectItem>
                        <SelectItem value="established-growing">{t('onboarding.presenceSelectOptions.establishedGrowing')}</SelectItem>
                        <SelectItem value="strong-presence">{t('onboarding.presenceSelectOptions.strongPresence')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 8 ─── What You Sell */}
            {step === 8 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step8Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step8Description')}
                  </p>
                </div>
                <div className="space-y-4">
                  <div>
                    <FieldLabel optional>{t('onboarding.whatDoYouOffer')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.offerPlaceholder')}
                      rows={3}
                      value={primary.offers}
                      onChange={e => setPri('offers', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <FieldLabel optional>{t('onboarding.priceRange')}</FieldLabel>
                    <Select value={primary.priceRange} onValueChange={v => setPri('priceRange', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.choosePriceRange')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="under-500">{t('onboarding.priceRangeSelectOptions.under500')}</SelectItem>
                        <SelectItem value="500-2000">{t('onboarding.priceRangeSelectOptions.range500to2000')}</SelectItem>
                        <SelectItem value="2000-5000">{t('onboarding.priceRangeSelectOptions.range2000to5000')}</SelectItem>
                        <SelectItem value="5000-15000">{t('onboarding.priceRangeSelectOptions.range5000to15000')}</SelectItem>
                        <SelectItem value="15000-plus">{t('onboarding.priceRangeSelectOptions.range15000Plus')}</SelectItem>
                        <SelectItem value="subscription">{t('onboarding.priceRangeSelectOptions.subscription')}</SelectItem>
                        <SelectItem value="variable">{t('onboarding.priceRangeSelectOptions.variable')}</SelectItem>
                        <SelectItem value="not-yet-set">{t('onboarding.priceRangeSelectOptions.notYetSet')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel optional>{t('onboarding.clientJourneyQuestion')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.clientJourneyPlaceholderAlt')}
                      rows={3}
                      value={primary.clientJourney}
                      onChange={e => setPri('clientJourney', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 9 ─── What Makes You Different */}
            {step === 9 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step9Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step9Description')}
                  </p>
                </div>
                <div className="space-y-5">
                  <div>
                    <FieldLabel optional>{t('onboarding.brandVoiceLabel')}</FieldLabel>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mb-2">{t('onboarding.brandVoiceHint')}</p>
                    <KeywordChipInput
                      values={primary.brandVoiceKeywords}
                      onChange={vals => setPrimary(p => ({ ...p, brandVoiceKeywords: vals }))}
                      max={6}
                      placeholder={t('onboarding.brandVoicePlaceholderAlt')}
                    />
                  </div>
                  <div>
                    <FieldLabel optional>{t('onboarding.antiKeywordsLabel')}</FieldLabel>
                    <KeywordChipInput
                      values={primary.brandVoiceAntiKeywords}
                      onChange={vals => setPrimary(p => ({ ...p, brandVoiceAntiKeywords: vals }))}
                      max={4}
                      placeholder={t('onboarding.antiKeywordsPlaceholder')}
                    />
                  </div>
                  <div>
                    <FieldLabel optional>{t('onboarding.editorialTerritoryQuestion')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.editorialTerritoryPlaceholderAlt')}
                      rows={2}
                      value={primary.editorialTerritory}
                      onChange={e => setPri('editorialTerritory', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <FieldLabel optional>{t('onboarding.competitorQuestion')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.competitorPlaceholderAlt')}
                      rows={2}
                      value={primary.competitorLandscape}
                      onChange={e => setPri('competitorLandscape', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 2: STEP 10 ─── Goals + Context */}
            {step === 10 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step10Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step10Description')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <FieldLabel optional>{t('onboarding.successQuestion')}</FieldLabel>
                    <Select value={primary.successDefinition} onValueChange={v => setPri('successDefinition', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseSuccessDefinition')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="consistent-revenue">{t('onboarding.successSelectOptions.consistentRevenue')}</SelectItem>
                        <SelectItem value="more-clients">{t('onboarding.successSelectOptions.moreClients')}</SelectItem>
                        <SelectItem value="recognized-expert">{t('onboarding.successSelectOptions.recognizedExpert')}</SelectItem>
                        <SelectItem value="growing-audience">{t('onboarding.successSelectOptions.growingAudience')}</SelectItem>
                        <SelectItem value="time-freedom">{t('onboarding.successSelectOptions.timeFreedom')}</SelectItem>
                        <SelectItem value="creative-output">{t('onboarding.successSelectOptions.creativeOutput')}</SelectItem>
                        <SelectItem value="team-systems">{t('onboarding.successSelectOptions.teamSystems')}</SelectItem>
                        <SelectItem value="personal-clarity">{t('onboarding.successSelectOptions.personalClarity')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.bandwidthQuestion')}</FieldLabel>
                    <Select value={primary.contentBandwidth} onValueChange={v => setPri('contentBandwidth', v)}>
                      <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.chooseBandwidth')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minimal">{t('onboarding.bandwidthSelectOptions.minimal')}</SelectItem>
                        <SelectItem value="light">{t('onboarding.bandwidthSelectOptions.light')}</SelectItem>
                        <SelectItem value="moderate">{t('onboarding.bandwidthSelectOptions.moderate')}</SelectItem>
                        <SelectItem value="active">{t('onboarding.bandwidthSelectOptions.active')}</SelectItem>
                        <SelectItem value="building-a-system">{t('onboarding.bandwidthSelectOptions.buildingSystem')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel optional>{t('onboarding.hardestPartQuestion')}</FieldLabel>
                    <Textarea
                      placeholder={t('onboarding.hardestPartPlaceholder')}
                      rows={3}
                      value={primary.currentChallenges}
                      onChange={e => setPri('currentChallenges', e.target.value)}
                      className="dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── LAYER 3: STEP 11 ─── Additional Projects */}
            {step === 11 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step11Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step11Description')}
                  </p>
                </div>

                {/* Existing additional projects */}
                {additionalProjects.length > 0 && (
                  <div className="space-y-2">
                    {additionalProjects.map(p => (
                      <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800">
                        <span className="text-base">{TYPE_ICON[p.type] || '📁'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-900 dark:text-white">{p.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {p.type && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{p.type}</Badge>}
                            {p.intent && <span className="text-[10px] text-slate-400 dark:text-gray-500">{INTENT_OPTIONS.find(o => o.value === p.intent)?.label}</span>}
                          </div>
                        </div>
                        <button onClick={() => removeAdditionalProject(p.id)} className="text-slate-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 flex-shrink-0 transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add project inline form */}
                {addingProject ? (
                  <div className="border border-primary/30 rounded-xl p-4 space-y-3 bg-primary/3">
                    <div>
                      <FieldLabel>{t('onboarding.projectNameLabel')}</FieldLabel>
                      <Input
                        placeholder={t('onboarding.projectNamePlaceholderNew')}
                        value={newProject.name}
                        onChange={e => setNewProject(p => ({ ...p, name: e.target.value }))}
                        autoFocus
                        className="dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel>{t('onboarding.projectType')}</FieldLabel>
                        <Select value={newProject.type} onValueChange={v => setNewProject(p => ({ ...p, type: v }))}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.projectTypePlaceholder')} /></SelectTrigger>
                          <SelectContent>
                            {PROJECT_TYPE_OPTIONS.map(o => (
                              <SelectItem key={o.value} value={o.value}>{o.icon} {o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <FieldLabel>{t('onboarding.projectIntent')}</FieldLabel>
                        <Select value={newProject.intent} onValueChange={v => setNewProject(p => ({ ...p, intent: v }))}>
                          <SelectTrigger className="dark:bg-gray-800 dark:border-gray-600"><SelectValue placeholder={t('onboarding.intentPlaceholder')} /></SelectTrigger>
                          <SelectContent>
                            {INTENT_OPTIONS.map(o => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <FieldLabel optional>{t('onboarding.shortDescription')}</FieldLabel>
                      <Input
                        placeholder={t('onboarding.shortDescriptionPlaceholder')}
                        value={newProject.description}
                        onChange={e => setNewProject(p => ({ ...p, description: e.target.value }))}
                        className="dark:bg-gray-800 dark:border-gray-600"
                      />
                    </div>

                    {/* Optional goal toggle */}
                    <button
                      type="button"
                      onClick={() => setShowGoalInNewProject(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-primary transition-colors"
                    >
                      {showGoalInNewProject ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {showGoalInNewProject ? t('onboarding.removeGoal') : t('onboarding.addGoalForProject')}
                    </button>

                    {showGoalInNewProject && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel optional>{t('onboarding.goalTitle')}</FieldLabel>
                          <Input placeholder={t('onboarding.goalQuestionPlaceholder')} value={newProject.goalTitle} onChange={e => setNewProject(p => ({ ...p, goalTitle: e.target.value }))} className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                        <div>
                          <FieldLabel optional>{t('onboarding.goalTimeframe')}</FieldLabel>
                          <Input placeholder={t('onboarding.timeframePlaceholderShort')} value={newProject.goalTimeframe} onChange={e => setNewProject(p => ({ ...p, goalTimeframe: e.target.value }))} className="dark:bg-gray-800 dark:border-gray-600" />
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={addAdditionalProject} disabled={!newProject.name.trim()}>
                        {t('onboarding.addProjectButton')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAddingProject(false); setNewProject({ name: "", type: "", intent: "", description: "", goalTitle: "", goalTimeframe: "" }); setShowGoalInNewProject(false); }}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  additionalProjects.length < 5 && (
                    <button
                      onClick={() => setAddingProject(true)}
                      className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:border-primary hover:text-primary transition-colors text-sm"
                    >
                      <Plus className="h-4 w-4" />
                      {t('onboarding.addProjectPrompt')}
                    </button>
                  )
                )}

                {additionalProjects.length === 0 && !addingProject && (
                  <p className="text-xs text-slate-400 dark:text-gray-500 text-center">
                    {t('onboarding.nothingToAddNow')}
                  </p>
                )}
              </div>
            )}

            {/* ─── STEP 12 ─── Review */}
            {step === 12 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl text-slate-900 dark:text-white">{t('onboarding.step12Title')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                    {t('onboarding.step12Description')}
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Operating profile summary */}
                  {(opProfile.energyRhythm || opProfile.planningStyle || opProfile.activationStyle) && (
                    <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-4">
                      <p className="text-xs text-violet-600 dark:text-violet-300 uppercase tracking-wider mb-2">{t('onboarding.howYouWorkSummary')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {opProfile.energyRhythm && <Badge variant="outline" className="text-xs border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300">{opProfile.energyRhythm.replace(/-/g, ' ')}</Badge>}
                        {opProfile.planningStyle && <Badge variant="outline" className="text-xs border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300">{opProfile.planningStyle.replace(/-/g, ' ')} {t('onboarding.plannerSuffix')}</Badge>}
                        {opProfile.activationStyle && <Badge variant="outline" className="text-xs border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300">{opProfile.activationStyle.replace(/-/g, ' ')}</Badge>}
                        {opProfile.avoidanceTriggers.length > 0 && <Badge variant="outline" className="text-xs border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300">{t('onboarding.avoidancePatternsNoted', { count: opProfile.avoidanceTriggers.length })}</Badge>}
                      </div>
                    </div>
                  )}

                  {/* Primary project */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <p className="text-xs text-primary uppercase tracking-wider mb-2">{t('onboarding.primaryProjectSummary')}</p>
                    <p className="font-semibold text-slate-900 dark:text-white">{primary.name}</p>
                    {primary.businessType && <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{primary.businessType.replace(/-/g, ' ')}</p>}
                    {primary.initialGoalTitle && (
                      <div className="mt-2 pt-2 border-t border-primary/10">
                        <p className="text-xs text-slate-600 dark:text-gray-300">
                          {t('onboarding.goalPrefix')} <span className="font-medium">{primary.initialGoalTitle}</span>
                          {primary.initialGoalTimeframe && ` · ${primary.initialGoalTimeframe}`}
                          {primary.initialGoalTarget && ` · ${primary.initialGoalTarget}`}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Additional projects */}
                  {additionalProjects.length > 0 && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
                      <p className="text-xs text-emerald-600 dark:text-emerald-300 uppercase tracking-wider mb-2">{t('onboarding.additionalProjectsSummary')}</p>
                      <div className="space-y-1.5">
                        {additionalProjects.map(p => (
                          <div key={p.id} className="flex items-center gap-2">
                            <span className="text-sm">{TYPE_ICON[p.type] || '📁'}</span>
                            <span className="text-sm text-slate-700 dark:text-gray-300">{p.name}</span>
                            {p.type && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300">{p.type}</Badge>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Navigation ─── */}
            {step > 1 && (<div className="flex items-center justify-between pt-8">
              <div className="flex items-center gap-2">
                {step > 1 && (
                  <Button type="button" variant="outline" onClick={back} className="flex items-center gap-1.5 dark:border-gray-600">
                    <ArrowLeft className="w-4 h-4" />
                    {t('common.back')}
                  </Button>
                )}
                {/* Skip Layer 1 button */}
                {(step === 2 || step === 3) && (
                  <button onClick={skipToLayer2} className="text-xs text-slate-400 dark:text-gray-500 hover:text-primary transition-colors ml-1">
                    {t('onboarding.skipThisSection')}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Skip Layer 2 button */}
                {step >= 6 && step <= 10 && (
                  <button onClick={skipToLayer3} className="text-xs text-slate-400 dark:text-gray-500 hover:text-primary transition-colors">
                    {t('onboarding.skipToFinish')}
                  </button>
                )}

                {step < TOTAL_STEPS ? (
                  <Button
                    type="button"
                    onClick={next}
                    disabled={!canProceed()}
                    className="flex items-center gap-1.5"
                  >
                    {t('common.next')}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending || !primary.name.trim()}
                    className="flex items-center gap-1.5 bg-primary px-6"
                  >
                    {submitMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.settingUp')}</>
                    ) : (
                      <>{t('onboarding.generateMyBoard')} <ArrowRight className="w-4 h-4" /></>
                    )}
                  </Button>
                )}
              </div>
            </div>)}

          </CardContent>
        </Card>

        {step > 1 && (
        <p className="text-center text-xs text-slate-400 dark:text-gray-500 mt-4">
          {t('onboarding.stepIndicator', { current: step - 1, total: TOTAL_STEPS - 1, layer: currentLayer.label })}
        </p>
        )}
      </div>
    </div>
  );
}
