import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Loader2 } from "lucide-react";
import type { BrandDna } from "@shared/schema";

// ─── Chip Keyword Input ──────────────────────────────────────────────────────
export function KeywordChipInput({
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
    <div className="flex flex-wrap gap-1.5 border border-naya-olive-18 rounded-lg px-2.5 py-2 bg-white min-h-[44px] focus-within:ring-1 focus-within:ring-primary/30 focus-within:border-primary/50 transition-colors">
      {values.map(kw => (
        <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
          {kw}
          <button type="button" onClick={() => onChange(values.filter(v => v !== kw))} className="hover:text-naya-mauve transition-colors leading-none">×</button>
        </span>
      ))}
      {values.length < max && (
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputVal.trim() && addKeyword(inputVal)}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] text-sm bg-transparent outline-none text-naya-olive-70 placeholder:text-naya-olive-35 :text-naya-cream0"
        />
      )}
    </div>
  );
}

// ─── Structured Content Pillar Editor ────────────────────────────────────────
export interface ContentPillar {
  name: string;
  description: string;
  formats: string[];
  frequency: string;
}

/**
 * Valeurs ENREGISTRÉES en base (jsonb `contentPillarsDetailed`). Elles ne changent pas avec
 * la langue : ce sont des identifiants, pas des libellés. Traduire la valeur stockée
 * casserait les ADN déjà enregistrés et rendrait un pilier créé en français illisible en
 * anglais. Seul l'affichage est traduit, via FORMAT_KEY.
 */
const CONTENT_FORMAT_OPTIONS = [
  'Long-form post', 'Short post', 'Carousel / slides', 'Newsletter article',
  'Video / Reel', 'Story / Ephemeral', 'Case study', 'Thread', 'Podcast episode', 'Infographic',
];

const FORMAT_KEY: Record<string, string> = {
  'Long-form post': 'brandDna.format.longFormPost',
  'Short post': 'brandDna.format.shortPost',
  'Carousel / slides': 'brandDna.format.carousel',
  'Newsletter article': 'brandDna.format.newsletterArticle',
  'Video / Reel': 'brandDna.format.videoReel',
  'Story / Ephemeral': 'brandDna.format.story',
  'Case study': 'brandDna.format.caseStudy',
  'Thread': 'brandDna.format.thread',
  'Podcast episode': 'brandDna.format.podcastEpisode',
  'Infographic': 'brandDna.format.infographic',
};

const FREQUENCY_KEY: Record<string, string> = {
  'daily': 'brandDna.frequency.daily',
  '2-3 per week': 'brandDna.frequency.twoThreePerWeek',
  'weekly': 'brandDna.frequency.weekly',
  'biweekly': 'brandDna.frequency.biweekly',
  'monthly': 'brandDna.frequency.monthly',
  'as needed': 'brandDna.frequency.asNeeded',
};

/**
 * Libellé affiché pour une valeur stockée. Une valeur inconnue — un ADN ancien, ou saisi
 * avant que la liste ne change — est rendue telle quelle plutôt que masquée.
 */
function libelle(t: (k: string) => string, table: Record<string, string>, valeur: string): string {
  const cle = table[valeur];
  return cle ? t(cle) : valeur;
}

export function PillarListEditor({
  pillars,
  onChange,
}: {
  pillars: ContentPillar[];
  onChange: (p: ContentPillar[]) => void;
}) {
  const { t } = useTranslation();
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
        <div key={i} className="border border-naya-olive-18 rounded-lg p-3 bg-white ">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-naya-olive-70 truncate">{p.name}</p>
              {p.description && <p className="text-xs text-naya-olive-55 mt-0.5 line-clamp-2">{p.description}</p>}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {p.formats.map(f => (
                  <span key={f} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{libelle(t, FORMAT_KEY, f)}</span>
                ))}
                {p.frequency && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-naya-olive-10 text-naya-olive-55">{libelle(t, FREQUENCY_KEY, p.frequency)}</span>}
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => startEdit(i)} className="text-[10px] text-naya-olive-35 hover:text-primary transition-colors px-1">{t('brandDna.edit')}</button>
              <button onClick={() => removePillar(i)} className="text-[10px] text-naya-olive-35 hover:text-naya-mauve transition-colors px-1">{t('brandDna.remove')}</button>
            </div>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="border border-primary/30 rounded-lg p-3 bg-primary/5 space-y-2.5">
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.pillarName')}</Label>
            <input
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder={t('brandDna.eGFounderMindset')}
              className="w-full text-sm border border-naya-olive-18 rounded-lg px-3 py-2 bg-white text-naya-olive-70 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.whatYouExploreInThisPillar')}</Label>
            <textarea
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder={t('brandDna.whatTopicsAnglesAndStoriesYou')}
              rows={2}
              className="w-full text-sm border border-naya-olive-18 rounded-lg px-3 py-2 bg-white text-naya-olive-70 outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.formatsYouUseForThisPillar')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_FORMAT_OPTIONS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFormat(f)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    draft.formats.includes(f)
                      ? 'bg-primary text-white border-primary'
                      : 'border-naya-olive-18 text-naya-olive-55 hover:border-primary/50'
                  }`}
                >
                  {libelle(t, FORMAT_KEY, f)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.publishingFrequency')}</Label>
            <select
              value={draft.frequency}
              onChange={e => setDraft(d => ({ ...d, frequency: e.target.value }))}
              className="w-full text-sm border border-naya-olive-18 rounded-lg px-3 py-2 bg-white text-naya-olive-70 outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="">{t('brandDna.chooseFrequency')}</option>
              <option value="daily">{t('brandDna.daily')}</option>
              <option value="2-3 per week">{t('brandDna.23PerWeek')}</option>
              <option value="weekly">{t('brandDna.weekly')}</option>
              <option value="biweekly">{t('brandDna.biweekly')}</option>
              <option value="monthly">{t('brandDna.monthly')}</option>
              <option value="as needed">{t('brandDna.asNeededAdHoc')}</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={saveDraft} disabled={!draft.name.trim()} className="text-xs h-7">{editIdx !== null ? t('brandDna.updatePillar') : t('brandDna.addPillar')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(empty); setEditIdx(null); }} className="text-xs h-7">{t('brandDna.cancel')}</Button>
          </div>
        </div>
      ) : pillars.length < 5 ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="text-xs w-full">{t('brandDna.addContentPillar')}</Button>
      ) : (
        <p className="text-[11px] text-naya-olive-35 text-center py-1">{t('brandDna.maximum5PillarsReached')}</p>
      )}
    </div>
  );
}

// ─── Structured Milestone Editor ──────────────────────────────────────────────
export interface Milestone {
  title: string;
  targetDate: string;
  status: 'pending' | 'in-progress' | 'done';
}

/**
 * Le statut porte une CLÉ de traduction, plus un libellé figé : cette table vit hors de
 * tout composant, donc `t` n'y est pas disponible. La traduction se fait au rendu.
 */
const STATUS_LABELS: Record<Milestone['status'], { key: string; cls: string }> = {
  pending: { key: 'brandDna.milestoneStatus.pending', cls: 'bg-naya-olive-10 text-naya-cream0 ' },
  'in-progress': { key: 'brandDna.milestoneStatus.inProgress', cls: 'bg-[rgba(125,143,168,0.20)] text-[#354963] ' },
  done: { key: 'brandDna.milestoneStatus.done', cls: 'bg-naya-olive-10 text-naya-olive ' },
};

export function MilestoneListEditor({
  milestones,
  onChange,
}: {
  milestones: Milestone[];
  onChange: (m: Milestone[]) => void;
}) {
  const { t } = useTranslation();
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
          <div key={i} className="border border-naya-olive-18 rounded-lg p-3 bg-white ">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-naya-olive-70 ">{m.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  {m.targetDate && <span className="text-[10px] text-naya-olive-35 ">→ {m.targetDate}</span>}
                  <button onClick={() => cycleStatus(i)} className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls} hover:opacity-80 transition-opacity`}>
                    {t(st.key)}
                  </button>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => startEdit(i)} className="text-[10px] text-naya-olive-35 hover:text-primary transition-colors px-1">{t('brandDna.edit')}</button>
                <button onClick={() => onChange(milestones.filter((_, j) => j !== i))} className="text-[10px] text-naya-olive-35 hover:text-naya-mauve transition-colors px-1">{t('brandDna.remove')}</button>
              </div>
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="border border-primary/30 rounded-lg p-3 bg-primary/5 space-y-2.5">
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.milestone')}</Label>
            <input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder={t('brandDna.eGLaunchBetaHit1000')}
              className="w-full text-sm border border-naya-olive-18 rounded-lg px-3 py-2 bg-white text-naya-olive-70 outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.targetDateOptional')}</Label>
            <input
              value={draft.targetDate}
              onChange={e => setDraft(d => ({ ...d, targetDate: e.target.value }))}
              placeholder={t('brandDna.eGApril2026Q22026')}
              className="w-full text-sm border border-naya-olive-18 rounded-lg px-3 py-2 bg-white text-naya-olive-70 outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.status')}</Label>
            <select
              value={draft.status}
              onChange={e => setDraft(d => ({ ...d, status: e.target.value as Milestone['status'] }))}
              className="w-full text-sm border border-naya-olive-18 rounded-lg px-3 py-2 bg-white text-naya-olive-70 outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="pending">{t('brandDna.pending')}</option>
              <option value="in-progress">{t('brandDna.inProgress')}</option>
              <option value="done">{t('brandDna.done')}</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={saveDraft} disabled={!draft.title.trim()} className="text-xs h-7">{editIdx !== null ? t('brandDna.updateMilestone') : t('brandDna.addMilestone')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(empty); setEditIdx(null); }} className="text-xs h-7">{t('brandDna.cancel')}</Button>
          </div>
        </div>
      ) : milestones.length < 5 ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="text-xs w-full">{t('brandDna.addMilestone2')}</Button>
      ) : (
        <p className="text-[11px] text-naya-olive-35 text-center py-1">{t('brandDna.maximum5MilestonesReached')}</p>
      )}
    </div>
  );
}

// ─── Full Brand DNA Editor (per-brand) ────────────────────────────────────────
/**
 * Éditeur ADN de marque complet. `projectId` = la marque éditée
 * (null = profil par défaut de l'utilisateur, conservé comme fallback backend).
 * Utilisé dans l'onglet ADN de chaque projet — chaque marque a son propre ADN.
 */
export function BrandDnaEditor({ projectId, projectName }: { projectId: number | null; projectName?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const brandDnaUrl = projectId ? `/api/projects/${projectId}/brand-dna` : '/api/brand-dna';
  const { data: brandDna, isLoading: brandDnaLoading } = useQuery<BrandDna | null>({
    queryKey: [brandDnaUrl],
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
    // d?. partout : quand on passe sur une marque sans ADN encore, le formulaire
    // se vide (au lieu de garder les valeurs de la marque précédente).
    const d = brandDna;
    setDnaBusinessName(d?.businessName || '');
    setDnaWebsite(d?.website || '');
    setDnaLinkedin(d?.linkedinProfile || '');
    setDnaInstagram(d?.instagramHandle || '');
    setDnaBusinessType(d?.businessType || '');
    setDnaBusinessModel(d?.businessModel || '');
    setDnaTargetAudience(d?.targetAudience || '');
    setDnaUniquePositioning(d?.uniquePositioning || '');
    setDnaCorePainPoint(d?.corePainPoint || '');
    setDnaAudienceAspiration(d?.audienceAspiration || '');
    setDnaAuthorityLevel(d?.authorityLevel || '');
    setDnaOffers(d?.offers || '');
    setDnaPriceRange(d?.priceRange || '');
    setDnaClientJourney(d?.clientJourney || '');
    setDnaCompetitorLandscape(d?.competitorLandscape || '');
    setDnaVoiceKw(d?.brandVoiceKeywords || []);
    setDnaAntiKw(d?.brandVoiceAntiKeywords || []);
    setDnaEditorialTerritory(d?.editorialTerritory || '');
    setDnaPlatformPriority(d?.platformPriority || '');
    setDnaCommunicationStyle(d?.communicationStyle || '');
    setDnaCurrentPresence(d?.currentPresence || '');
    setDnaContentBandwidth(d?.contentBandwidth || '');
    setDnaVisualIdentityNotes(d?.visualIdentityNotes || '');
    setDnaReferenceBrands(d?.referenceBrands || []);
    // contentPillarsDetailed: jsonb — stored as ContentPillar[] objects
    const pillarsRaw = d?.contentPillarsDetailed;
    if (Array.isArray(pillarsRaw)) {
      setDnaContentPillarsDetailed(pillarsRaw.map((p: any) =>
        typeof p === 'string'
          ? { name: p, description: '', formats: [], frequency: '' }
          : { name: p?.name || '', description: p?.description || '', formats: Array.isArray(p?.formats) ? p.formats : [], frequency: p?.frequency || '' }
      ));
    } else {
      setDnaContentPillarsDetailed([]);
    }
    setDnaActiveBusinessPriority(d?.activeBusinessPriority || '');
    setDnaCurrentBusinessStage(d?.currentBusinessStage || '');
    setDnaRevenueTarget(d?.revenueTarget || '');
    setDnaRevenueUrgency(d?.revenueUrgency || '');
    setDnaPrimaryGoal(d?.primaryGoal || '');
    setDnaSuccessDefinition(d?.successDefinition || '');
    setDnaCurrentChallenges(d?.currentChallenges || '');
    setDnaTeamStructure(d?.teamStructure || '');
    setDnaOperationalConstraints(d?.operationalConstraints || '');
    setDnaGeographicFocus(d?.geographicFocus || '');
    setDnaLanguageStrategy(d?.languageStrategy || '');
    // keyMilestones: jsonb — stored as Milestone[] objects
    const milestonesRaw = d?.keyMilestones;
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

  const patchBrandDna = useMutation({
    mutationFn: (data: Partial<BrandDna>) => apiRequest('PATCH', brandDnaUrl, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [brandDnaUrl] });
      if (projectId) queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'brand-dna'] });
      toast({ title: t('settings.saved') });
    },
    onError: () => toast({ title: t('common.error'), description: t('settings.failedToSave'), variant: "destructive" }),
  });

  const refreshIntelligence = useMutation({
    mutationFn: () => apiRequest('POST', '/api/brand-dna/refresh-intelligence', projectId ? { projectId } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [brandDnaUrl] });
      toast({ title: t('settings.saved') });
    },
    onError: () => toast({ title: t('common.error'), description: t('settings.failedToSave'), variant: "destructive" }),
  });

  if (brandDnaLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-naya-olive-35 ">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> {t('brandDna.loading')}
      </div>
    );
  }

  return (
    <div>
      {projectId && brandDna && !(brandDna as any).projectId && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-[rgba(125,143,168,0.12)] border border-[rgba(125,143,168,0.35)]">
          <Sparkles className="h-3.5 w-3.5 text-naya-salvia mt-0.5 flex-shrink-0" />
          <p className="text-xs text-[#354963]">
            {t('brandDna.inheritedFromGlobal')} <strong>{projectName || t('brandDna.thisBrand')}</strong>.
          </p>
        </div>
      )}

      <Tabs defaultValue="identity">
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 w-full h-auto gap-1 text-xs">
          <TabsTrigger className="whitespace-normal leading-tight py-1.5 h-auto" value="identity">{t('settings.tabs.identity')}</TabsTrigger>
          <TabsTrigger className="whitespace-normal leading-tight py-1.5 h-auto" value="offers">{t('settings.tabs.offersMarket')}</TabsTrigger>
          <TabsTrigger className="whitespace-normal leading-tight py-1.5 h-auto" value="content">{t('settings.tabs.contentPlatforms')}</TabsTrigger>
          <TabsTrigger className="whitespace-normal leading-tight py-1.5 h-auto" value="priorities">{t('settings.tabs.activePriorities')}</TabsTrigger>
          <TabsTrigger className="whitespace-normal leading-tight py-1.5 h-auto" value="intelligence">{t('settings.tabs.nayaIntelligence')}</TabsTrigger>
        </TabsList>

        {/* ── Identity ── */}
        <TabsContent value="identity" className="space-y-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('brandDna.businessBrandName')}</Label>
              <Input value={dnaBusinessName} onChange={e => setDnaBusinessName(e.target.value)} className=" " />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('brandDna.website')}</Label>
              <Input value={dnaWebsite} onChange={e => setDnaWebsite(e.target.value)} placeholder={t('brandDna.https')} className=" " />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('brandDna.linkedinProfile')}</Label>
              <Input value={dnaLinkedin} onChange={e => setDnaLinkedin(e.target.value)} placeholder={t('brandDna.linkedinComIn')} className=" " />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('brandDna.instagramHandle')}</Label>
              <Input value={dnaInstagram} onChange={e => setDnaInstagram(e.target.value)} placeholder={t('brandDna.handle')} className=" " />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.businessType')}</Label>
            <Input value={dnaBusinessType} onChange={e => setDnaBusinessType(e.target.value)} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.businessModel')}</Label>
            <Input value={dnaBusinessModel} onChange={e => setDnaBusinessModel(e.target.value)} placeholder={t('brandDna.eGServicesProductsSaas')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.uniquePositioning')}</Label>
            <Textarea value={dnaUniquePositioning} onChange={e => setDnaUniquePositioning(e.target.value)} rows={2} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.yourAuthorityLevel')}</Label>
            <Select value={dnaAuthorityLevel} onValueChange={setDnaAuthorityLevel}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseALevel')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="emerging">{t('brandDna.emergingBuildingCredibility')}</SelectItem>
                <SelectItem value="established">{t('brandDna.establishedKnownInMyNiche')}</SelectItem>
                <SelectItem value="authority">{t('brandDna.authorityWidelyRecognized')}</SelectItem>
                <SelectItem value="thought-leader">{t('brandDna.thoughtLeaderIndustryVoice')}</SelectItem>
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
            <Label className="text-xs">{t('brandDna.whatDoYouOffer')}</Label>
            <Textarea value={dnaOffers} onChange={e => setDnaOffers(e.target.value)} rows={3} placeholder={t('brandDna.servicesProductsPrograms')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.priceRange')}</Label>
            <Select value={dnaPriceRange} onValueChange={setDnaPriceRange}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseARange')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="under-500">{t('brandDna.under500Project')}</SelectItem>
                <SelectItem value="500-2000">€500 – €2,000</SelectItem>
                <SelectItem value="2000-5000">€2,000 – €5,000</SelectItem>
                <SelectItem value="5000-15000">€5,000 – €15,000</SelectItem>
                <SelectItem value="15000-plus">€15,000+</SelectItem>
                <SelectItem value="subscription">{t('brandDna.subscriptionRecurring')}</SelectItem>
                <SelectItem value="variable">{t('brandDna.variableDependsOnScope')}</SelectItem>
                <SelectItem value="not-yet-set">{t('brandDna.notSetYet')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.clientJourneyDiscoveryPurchase')}</Label>
            <Textarea value={dnaClientJourney} onChange={e => setDnaClientJourney(e.target.value)} rows={2} placeholder={t('brandDna.howClientsFindAndBuyFrom')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.competitiveLandscape')}</Label>
            <Textarea value={dnaCompetitorLandscape} onChange={e => setDnaCompetitorLandscape(e.target.value)} rows={2} placeholder={t('brandDna.whoYouReDifferentFromAnd')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.targetAudience')}</Label>
            <Textarea value={dnaTargetAudience} onChange={e => setDnaTargetAudience(e.target.value)} rows={2} placeholder={t('brandDna.whoYouServeRoleContextMindset')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.coreAudiencePainPoint')}</Label>
            <Textarea value={dnaCorePainPoint} onChange={e => setDnaCorePainPoint(e.target.value)} rows={2} placeholder={t('brandDna.the1FrustrationOrStruggleYour')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.audienceAspiration')}</Label>
            <Textarea value={dnaAudienceAspiration} onChange={e => setDnaAudienceAspiration(e.target.value)} rows={2} placeholder={t('brandDna.whatYourAudienceMostWantsTo')} className=" " />
          </div>
          <Button size="sm" onClick={() => patchBrandDna.mutate({ offers: dnaOffers, priceRange: dnaPriceRange, clientJourney: dnaClientJourney, competitorLandscape: dnaCompetitorLandscape, targetAudience: dnaTargetAudience, corePainPoint: dnaCorePainPoint, audienceAspiration: dnaAudienceAspiration })} disabled={patchBrandDna.isPending}>
            {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveOffersMarket')}
          </Button>
        </TabsContent>

        {/* ── Content & Platforms ── */}
        <TabsContent value="content" className="space-y-4 pt-4">
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.brandVoiceKeywordsUpTo6')}</Label>
            <p className="text-[11px] text-naya-olive-35 ">{t('brandDna.pressEnterOrCommaToAdd')}</p>
            <KeywordChipInput values={dnaVoiceKw} onChange={setDnaVoiceKw} max={6} placeholder={t('brandDna.eGDirectWarmPrecise')} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.wordsTonesToAvoidUpTo')}</Label>
            <KeywordChipInput values={dnaAntiKw} onChange={setDnaAntiKw} max={4} placeholder={t('brandDna.eGCorporateSalesyJargon')} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.editorialTerritory')}</Label>
            <Textarea value={dnaEditorialTerritory} onChange={e => setDnaEditorialTerritory(e.target.value)} rows={2} placeholder={t('brandDna.theIntersectionOfBrandAndPsychology')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.contentPillars')}</Label>
            <p className="text-[11px] text-naya-olive-35 ">{t('brandDna.defineEachPillarWithItsFormats')}</p>
            <PillarListEditor pillars={dnaContentPillarsDetailed} onChange={setDnaContentPillarsDetailed} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.primaryPlatform')}</Label>
            <Select value={dnaPlatformPriority} onValueChange={setDnaPlatformPriority}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.choosePrimaryPlatform')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linkedin">{t('brandDna.linkedin')}</SelectItem>
                <SelectItem value="instagram">{t('brandDna.instagram')}</SelectItem>
                <SelectItem value="twitter">{t('brandDna.xTwitter')}</SelectItem>
                <SelectItem value="newsletter">{t('brandDna.newsletterEmail')}</SelectItem>
                <SelectItem value="youtube">{t('brandDna.youtube')}</SelectItem>
                <SelectItem value="tiktok">{t('brandDna.tiktok')}</SelectItem>
                <SelectItem value="podcast">{t('brandDna.podcast')}</SelectItem>
                <SelectItem value="blog">{t('brandDna.blogSeo')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.communicationStyle')}</Label>
            <Select value={dnaCommunicationStyle} onValueChange={setDnaCommunicationStyle}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseStyle')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conversational">{t('brandDna.conversationalWarmAndApproachable')}</SelectItem>
                <SelectItem value="authoritative">{t('brandDna.authoritativeDirectAndConfident')}</SelectItem>
                <SelectItem value="educational">{t('brandDna.educationalClearAndStructured')}</SelectItem>
                <SelectItem value="inspirational">{t('brandDna.inspirationalMotivatingAndVisionary')}</SelectItem>
                <SelectItem value="provocative">{t('brandDna.provocativeChallengesAssumptions')}</SelectItem>
                <SelectItem value="storytelling">{t('brandDna.storytellingNarrativeDriven')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.currentOnlinePresence')}</Label>
            <Select value={dnaCurrentPresence} onValueChange={setDnaCurrentPresence}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.choosePresenceLevel')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('brandDna.noneStartingFromScratch')}</SelectItem>
                <SelectItem value="minimal">{t('brandDna.minimalBasicProfilesOnly')}</SelectItem>
                <SelectItem value="growing">{t('brandDna.growingSomeFollowersReaders')}</SelectItem>
                <SelectItem value="established">{t('brandDna.establishedConsistentAudience')}</SelectItem>
                <SelectItem value="strong">{t('brandDna.strongLargeEngagedFollowing')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.contentBandwidth')}</Label>
            <Select value={dnaContentBandwidth} onValueChange={setDnaContentBandwidth}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.howMuchCanYouPublish')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">{t('brandDna.minimal12PostsWeekMax')}</SelectItem>
                <SelectItem value="moderate">{t('brandDna.moderate35PiecesWeek')}</SelectItem>
                <SelectItem value="active">{t('brandDna.activeDailyContent')}</SelectItem>
                <SelectItem value="high-volume">{t('brandDna.highVolumeMultiplePerDay')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.visualIdentityNotes')}</Label>
            <Textarea value={dnaVisualIdentityNotes} onChange={e => setDnaVisualIdentityNotes(e.target.value)} rows={2} placeholder={t('brandDna.eGMinimalWarmTonesNo')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.referenceBrandsUpTo5')}</Label>
            <p className="text-[11px] text-naya-olive-35 ">{t('brandDna.brandsWhoseStyleOrApproachYou')}</p>
            <KeywordChipInput values={dnaReferenceBrands} onChange={setDnaReferenceBrands} max={5} placeholder={t('brandDna.eGNotionBasecampFigma')} />
          </div>
          <Button size="sm" onClick={() => patchBrandDna.mutate({ brandVoiceKeywords: dnaVoiceKw, brandVoiceAntiKeywords: dnaAntiKw, editorialTerritory: dnaEditorialTerritory, contentPillarsDetailed: dnaContentPillarsDetailed, platformPriority: dnaPlatformPriority, communicationStyle: dnaCommunicationStyle, currentPresence: dnaCurrentPresence, contentBandwidth: dnaContentBandwidth, visualIdentityNotes: dnaVisualIdentityNotes, referenceBrands: dnaReferenceBrands })} disabled={patchBrandDna.isPending}>
            {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveContentPlatforms')}
          </Button>
        </TabsContent>

        {/* ── Active Priorities ── */}
        <TabsContent value="priorities" className="space-y-4 pt-4">
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.activeBusinessPriority')}</Label>
            <Input value={dnaActiveBusinessPriority} onChange={e => setDnaActiveBusinessPriority(e.target.value)} placeholder={t('brandDna.eGClose2NewClients')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.currentBusinessStage')}</Label>
            <Select value={dnaCurrentBusinessStage} onValueChange={setDnaCurrentBusinessStage}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseAStage')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="idea">{t('brandDna.ideaPreLaunch')}</SelectItem>
                <SelectItem value="launch">{t('brandDna.launchedEarlyTraction')}</SelectItem>
                <SelectItem value="growing">{t('brandDna.growing')}</SelectItem>
                <SelectItem value="scaling">{t('brandDna.scaling')}</SelectItem>
                <SelectItem value="established">{t('brandDna.established')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.revenueUrgency')}</Label>
            <Select value={dnaRevenueUrgency} onValueChange={setDnaRevenueUrgency}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseUrgency')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="revenue-now">{t('brandDna.needRevenueNowCritical')}</SelectItem>
                <SelectItem value="3-months">{t('brandDna.within3Months')}</SelectItem>
                <SelectItem value="growing-steadily">{t('brandDna.growingSteadilyNotUrgent')}</SelectItem>
                <SelectItem value="authority-building">{t('brandDna.buildingAuthorityFirst')}</SelectItem>
                <SelectItem value="scale-existing">{t('brandDna.scalingWhatSAlreadyWorking')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.revenueTarget')}</Label>
            <Input value={dnaRevenueTarget} onChange={e => setDnaRevenueTarget(e.target.value)} placeholder={t('brandDna.eG5kMonthByQ3')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.keyMilestones')}</Label>
            <p className="text-[11px] text-naya-olive-35 ">{t('brandDna.trackEachMilestoneWithATarget')}</p>
            <MilestoneListEditor milestones={dnaKeyMilestones} onChange={setDnaKeyMilestones} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.primaryGoal')}</Label>
            <Textarea value={dnaPrimaryGoal} onChange={e => setDnaPrimaryGoal(e.target.value)} rows={2} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.successDefinition')}</Label>
            <Textarea value={dnaSuccessDefinition} onChange={e => setDnaSuccessDefinition(e.target.value)} rows={2} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.currentChallenges')}</Label>
            <Textarea value={dnaCurrentChallenges} onChange={e => setDnaCurrentChallenges(e.target.value)} rows={2} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.teamStructure')}</Label>
            <Select value={dnaTeamStructure} onValueChange={setDnaTeamStructure}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseTeamStructure')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="solo">{t('brandDna.soloFounderIWorkAlone')}</SelectItem>
                <SelectItem value="solo-contractors">{t('brandDna.soloContractorsAsNeeded')}</SelectItem>
                <SelectItem value="2-3-person">{t('brandDna.23PersonTeam')}</SelectItem>
                <SelectItem value="small-team">{t('brandDna.smallTeam410')}</SelectItem>
                <SelectItem value="growing-team">{t('brandDna.growingTeam10')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.operationalConstraints')}</Label>
            <Textarea value={dnaOperationalConstraints} onChange={e => setDnaOperationalConstraints(e.target.value)} rows={2} placeholder={t('brandDna.eGLimitedTime10hWeek')} className=" " />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.geographicFocus')}</Label>
            <Select value={dnaGeographicFocus} onValueChange={setDnaGeographicFocus}>
              <SelectTrigger className=" "><SelectValue placeholder={t('brandDna.chooseGeographicFocus')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">{t('brandDna.localCity')}</SelectItem>
                <SelectItem value="national">{t('brandDna.national')}</SelectItem>
                <SelectItem value="europe">{t('brandDna.europe')}</SelectItem>
                <SelectItem value="english-speaking">{t('brandDna.englishSpeakingMarkets')}</SelectItem>
                <SelectItem value="global">{t('brandDna.global')}</SelectItem>
                <SelectItem value="remote-global">{t('brandDna.remoteFullyGlobal')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('brandDna.languageStrategy')}</Label>
            <Input value={dnaLanguageStrategy} onChange={e => setDnaLanguageStrategy(e.target.value)} placeholder={t('brandDna.eGEnglishOnlyBilingualEn')} className=" " />
          </div>
          <Button size="sm" onClick={() => patchBrandDna.mutate({ activeBusinessPriority: dnaActiveBusinessPriority, currentBusinessStage: dnaCurrentBusinessStage, revenueUrgency: dnaRevenueUrgency, revenueTarget: dnaRevenueTarget, keyMilestones: dnaKeyMilestones, primaryGoal: dnaPrimaryGoal, successDefinition: dnaSuccessDefinition, currentChallenges: dnaCurrentChallenges, teamStructure: dnaTeamStructure, operationalConstraints: dnaOperationalConstraints, geographicFocus: dnaGeographicFocus, languageStrategy: dnaLanguageStrategy })} disabled={patchBrandDna.isPending}>
            {patchBrandDna.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('settings.saving')}</> : t('settings.saveActivePriorities')}
          </Button>
        </TabsContent>

        {/* ── Naya Intelligence ── */}
        <TabsContent value="intelligence" className="space-y-4 pt-4">
          <div className="rounded-lg bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> {t('settings.strategicSummary')}
              </p>
              {brandDna?.lastStrategyRefreshAt && (
                <span className="text-[10px] text-naya-olive-35 ">
                  {t('brandDna.lastUpdated')} {new Date(brandDna.lastStrategyRefreshAt).toLocaleDateString()}
                </span>
              )}
            </div>
            {brandDna?.nayaIntelligenceSummary ? (
              <p className="text-sm text-naya-olive-70 leading-relaxed whitespace-pre-wrap">
                {brandDna.nayaIntelligenceSummary}
              </p>
            ) : (
              <p className="text-sm text-naya-olive-35 italic">
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
    </div>
  );
}
