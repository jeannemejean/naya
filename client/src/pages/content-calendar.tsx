import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format } from 'date-fns/format';
import { parse } from 'date-fns/parse';
import { startOfWeek } from 'date-fns/startOfWeek';
import { getDay } from 'date-fns/getDay';
import { enUS } from 'date-fns/locale/en-US';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar as CalendarIcon, List, Search, Settings, Check, X, ExternalLink, Image, Upload, Trash2, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Lightbulb } from 'lucide-react';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

import Sidebar from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ObjectUploader } from '@/components/ObjectUploader';

import type { Content, SocialAccount, MediaLibrary, TargetPersona, PersonaAnalysisResult, Project } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
const locales = { 'en-US': enUS };

const localizer = dateFnsLocalizer({
  format, parse, startOfWeek, getDay, locales,
});

const DragAndDropCalendar = withDragAndDrop(Calendar);

interface ContentEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resource: Content;
}

interface PostFormData {
  title: string;
  body: string;
  platform: string;
  contentType: string;
  pillar: string;
  goal: string;
  contentStatus: string;
  scheduledFor?: Date;
  mediaUrl?: string;
  mediaFileName?: string;
}

type StrategyReportResponse = {
  id: number;
  weeklyFocus: string;
  insights: string[];
  recommendations: string[];
  nextWeekPlan: Record<string, string>;
};

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram', color: 'bg-gradient-to-r from-purple-500 to-pink-500', dotColor: '#a855f7', charLimit: 2200 },
  { value: 'linkedin', label: 'LinkedIn', color: 'bg-blue-600', dotColor: '#2563eb', charLimit: 3000 },
  { value: 'twitter', label: 'Twitter', color: 'bg-sky-500', dotColor: '#0ea5e9', charLimit: 280 },
  { value: 'facebook', label: 'Facebook', color: 'bg-blue-700', dotColor: '#1d4ed8', charLimit: 63206 },
  { value: 'email', label: 'Email', color: 'bg-green-600', dotColor: '#16a34a', charLimit: 10000 },
  { value: 'blog', label: 'Blog', color: 'bg-gray-700', dotColor: '#374151', charLimit: 50000 },
];

const CONTENT_TYPES = [
  { value: 'post', label: 'Social Post' },
  { value: 'story', label: 'Story' },
  { value: 'email', label: 'Email' },
  { value: 'article', label: 'Article' },
];

const GOALS = [
  { value: 'visibility', label: 'Visibility' },
  { value: 'trust', label: 'Trust Building' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'engagement', label: 'Engagement' },
];

const CONTENT_STATUS_STEPS = ['idea', 'draft', 'ready', 'published'] as const;
type ContentStatusStep = typeof CONTENT_STATUS_STEPS[number];

const CONTENT_STATUS_LABELS: Record<ContentStatusStep, string> = {
  idea: 'Idea',
  draft: 'Draft',
  ready: 'Ready',
  published: 'Published',
};

const CONTENT_STATUS_COLORS: Record<ContentStatusStep, string> = {
  idea: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  draft: 'bg-blue-100 text-blue-800 border-blue-200',
  ready: 'bg-green-100 text-green-800 border-green-200',
  published: 'bg-purple-100 text-purple-800 border-purple-200',
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface ContentCalendarProps {
  onSearchClick?: () => void;
}

export default function ContentCalendar({ onSearchClick }: ContentCalendarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [view, setView] = useState<'pipeline' | 'calendar' | 'accounts' | 'media'>('pipeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Content | null>(null);
  const [showStrategyRecs, setShowStrategyRecs] = useState(false);
  const [formData, setFormData] = useState<PostFormData>({
    title: '',
    body: '',
    platform: 'instagram',
    contentType: 'post',
    pillar: '',
    goal: 'engagement',
    contentStatus: 'idea',
  });

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      const primary = projects.find(p => p.isPrimary) || projects[0];
      setSelectedProjectId(primary.id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const now = new Date();
  const currentWeek = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-W' + Math.ceil(now.getDate() / 7);

  const { data: content = [], isLoading } = useQuery<Content[]>({
    queryKey: ['/api/content', selectedProjectId],
    queryFn: () => {
      const url = selectedProjectId
        ? `/api/content?projectId=${selectedProjectId}`
        : '/api/content';
      return fetch(url, { credentials: 'include' }).then(r => r.json());
    },
    enabled: !!selectedProjectId,
  });

  const { data: strategyReport } = useQuery<StrategyReportResponse | null>({
    queryKey: ['/api/strategy/report', selectedProjectId, currentWeek],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const res = await apiRequest('GET', `/api/strategy/report?week=${currentWeek}&projectId=${selectedProjectId}`);
      const data = await res.json();
      return data && data.id ? data : null;
    },
    enabled: !!selectedProjectId,
  });

  const createContentMutation = useMutation({
    mutationFn: (data: PostFormData) =>
      fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, projectId: selectedProjectId }),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/content', selectedProjectId] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: t('contentCalendar.contentCreated') });
    },
    onError: () => {
      toast({ title: t('contentCalendar.failedToCreate'), variant: 'destructive' });
    },
  });

  const updateContentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Content> }) =>
      fetch(`/api/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/content', selectedProjectId] });
    },
  });

  const deleteContentMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/content/${id}`, { method: 'DELETE' }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/content', selectedProjectId] });
      toast({ title: t('contentCalendar.contentDeleted') });
    },
  });

  const { data: socialAccounts = [] } = useQuery({
    queryKey: ['/api/social-accounts'],
    queryFn: () => fetch('/api/social-accounts').then(res => res.json()),
  });

  const connectAccountMutation = useMutation({
    mutationFn: (data: { platform: string; accessToken: string; accountId: string; accountName: string }) =>
      fetch('/api/social-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social-accounts'] });
      toast({ title: t('contentCalendar.accountConnected') });
    },
    onError: () => {
      toast({ title: t('contentCalendar.failedToCreate'), variant: 'destructive' });
    },
  });

  const disconnectAccountMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/social-accounts/${id}`, { method: 'DELETE' }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social-accounts'] });
      toast({ title: t('contentCalendar.accountDisconnected') });
    },
  });

  const { data: mediaLibrary = [], isLoading: mediaLoading } = useQuery({
    queryKey: ['/api/media-library'],
    queryFn: () => fetch('/api/media-library').then(res => res.json()),
  });

  const uploadMediaMutation = useMutation({
    mutationFn: async (data: { fileUrl: string; fileName: string; fileType: string; fileSize: number }) =>
      fetch('/api/media-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/media-library'] });
      toast({ title: t('contentCalendar.mediaUploaded') });
    },
    onError: () => {
      toast({ title: t('contentCalendar.failedToCreate'), variant: 'destructive' });
    },
  });

  const deleteMediaMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/media-library/${id}`, { method: 'DELETE' }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/media-library'] });
      toast({ title: t('contentCalendar.mediaDeleted') });
    },
  });

  const { data: personaResult } = useQuery<PersonaAnalysisResult | null>({
    queryKey: ['/api/persona/my-persona'],
  });
  const { data: targetPersonas = [] } = useQuery<TargetPersona[]>({
    queryKey: ['/api/persona/target-personas', selectedProjectId],
    queryFn: () => {
      const url = selectedProjectId
        ? `/api/persona/target-personas?projectId=${selectedProjectId}`
        : '/api/persona/target-personas';
      return fetch(url, { credentials: 'include' }).then(r => r.json());
    },
  });

  const generateContentMutation = useMutation({
    mutationFn: (params: { platform: string; goal: string; pillar: string; topic: string }) =>
      fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          projectId: selectedProjectId,
        }),
      }).then(res => res.json()),
    onSuccess: (data: { title: string; content: string; pillar: string }) => {
      setFormData(prev => ({
        ...prev,
        title: data.title,
        body: data.content,
        pillar: data.pillar,
      }));
      toast({ title: t('contentCalendar.aiContentGenerated') });
    },
  });

  const publishContentMutation = useMutation({
    mutationFn: async (contentId: number) => {
      const response = await fetch(`/api/content/${contentId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data: { platform: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/content', selectedProjectId] });
      toast({ title: t('contentCalendar.contentPublished'), description: t('contentCalendar.postedTo', { platform: data.platform }) });
    },
    onError: (error: Error) => {
      toast({ title: t('contentCalendar.failedToPublish'), description: error.message || t('contentCalendar.checkAccountConnection'), variant: 'destructive' });
    },
  });

  const filteredContent = content.filter((item: Content) => {
    if (searchQuery && !item.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !item.body.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const events: ContentEvent[] = filteredContent
    .filter((item: Content) => item.scheduledFor)
    .map((item: Content) => ({
      id: item.id,
      title: item.title,
      start: new Date(item.scheduledFor!),
      end: new Date(new Date(item.scheduledFor!).getTime() + 60 * 60 * 1000),
      resource: item,
    }));

  const resetForm = () => {
    setFormData({
      title: '', body: '', platform: 'instagram', contentType: 'post',
      pillar: '', goal: 'engagement', contentStatus: 'idea',
      mediaUrl: undefined, mediaFileName: undefined,
    });
    setSelectedPost(null);
    setShowStrategyRecs(false);
  };

  const handleCreatePost = () => {
    createContentMutation.mutate(formData);
  };

  const handleCreateAndPublish = async () => {
    try {
      const response = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, projectId: selectedProjectId }),
      });
      if (!response.ok) throw new Error('Failed to create content');
      const createdContent = await response.json();
      publishContentMutation.mutate(createdContent.id);
      queryClient.invalidateQueries({ queryKey: ['/api/content', selectedProjectId] });
      setShowCreateDialog(false);
      resetForm();
    } catch {
      toast({ title: t('contentCalendar.failedToCreateAndPublish'), variant: 'destructive' });
    }
  };

  const handleUpdatePost = (id: number, updates: Partial<Content>) => {
    updateContentMutation.mutate({ id, data: updates });
  };

  const handleSelectEvent = (event: ContentEvent) => {
    setSelectedPost(event.resource);
    setFormData({
      title: event.resource.title,
      body: event.resource.body,
      platform: event.resource.platform,
      contentType: event.resource.contentType,
      pillar: event.resource.pillar,
      goal: event.resource.goal,
      contentStatus: event.resource.contentStatus || 'idea',
      scheduledFor: event.resource.scheduledFor ? new Date(event.resource.scheduledFor) : undefined,
      mediaUrl: event.resource.mediaUrl || undefined,
      mediaFileName: event.resource.mediaFileName || undefined,
    });
    setShowCreateDialog(true);
  };

  const handleConnectAccount = (platform: string) => {
    const demoAccessToken = `demo_token_${Date.now()}`;
    const demoAccountId = `demo_id_${Date.now()}`;
    const demoAccountName = `Demo ${platform.charAt(0).toUpperCase() + platform.slice(1)} Account`;
    connectAccountMutation.mutate({ platform, accessToken: demoAccessToken, accountId: demoAccountId, accountName: demoAccountName });
    toast({ title: t('contentCalendar.demoAccountConnected', { platform: platform.charAt(0).toUpperCase() + platform.slice(1) }), description: t('contentCalendar.demoConnectionDescription') });
  };

  const handleGenerateContent = () => {
    if (!formData.platform || !formData.goal || !formData.pillar) {
      toast({ title: t('contentCalendar.fillFieldsFirst'), variant: 'destructive' });
      return;
    }
    generateContentMutation.mutate({
      platform: formData.platform, goal: formData.goal, pillar: formData.pillar,
      topic: formData.title || 'general business topic',
    });
  };

  const handleGetUploadParameters = async () => {
    try {
      const response = await fetch('/api/objects/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await response.json();
      return { method: 'PUT' as const, url: data.uploadURL };
    } catch (error) {
      toast({ title: t('contentCalendar.failedToGetUploadUrl'), variant: 'destructive' });
      throw error;
    }
  };

  const handleUploadComplete = (result: any) => {
    if (result.successful && result.successful.length > 0) {
      const file = result.successful[0];
      uploadMediaMutation.mutate({ fileUrl: file.uploadURL, fileName: file.name || 'Uploaded file', fileType: file.type || 'unknown', fileSize: file.size || 0 });
    }
  };

  const handlePostMediaUpload = (result: any) => {
    if (result.successful && result.successful.length > 0) {
      const file = result.successful[0];
      setFormData(prev => ({ ...prev, mediaUrl: file.uploadURL, mediaFileName: file.name || 'Uploaded media' }));
      toast({ title: t('contentCalendar.mediaUploaded') });
    }
  };

  const handleDeleteMedia = (id: number) => {
    if (confirm(t('contentCalendar.deleteMediaConfirm'))) {
      deleteMediaMutation.mutate(id);
    }
  };

  const handleEventDrop = ({ event, start }: { event: ContentEvent; start: Date; end: Date }) => {
    handleUpdatePost(event.id, { scheduledFor: start });
    toast({ title: t('contentCalendar.eventMoved'), description: t('contentCalendar.rescheduledTo', { date: format(start, 'MMM d, h:mm a') }) });
  };

  const handleEventResize = ({ event, start }: { event: ContentEvent; start: Date; end: Date }) => {
    handleUpdatePost(event.id, { scheduledFor: start });
    toast({ title: t('contentCalendar.eventUpdated'), description: t('contentCalendar.rescheduledTo', { date: format(start, 'MMM d, h:mm a') }) });
  };

  const handleSelectSlot = ({ start }: { start: Date }) => {
    setFormData(prev => ({ ...prev, scheduledFor: start }));
    setShowCreateDialog(true);
  };

  const getPlatformInfo = (platform: string) => {
    return PLATFORMS.find(p => p.value === platform) || PLATFORMS[0];
  };

  const getCharacterCount = (text: string | undefined) => (text ?? '').length;

  const getCharacterStatus = (count: number, limit: number) => {
    const percentage = (count / limit) * 100;
    if (percentage >= 100) return { status: 'error', color: 'text-red-600' };
    if (percentage >= 90) return { status: 'warning', color: 'text-yellow-600' };
    if (percentage >= 75) return { status: 'caution', color: 'text-orange-600' };
    return { status: 'ok', color: 'text-gray-500' };
  };

  const formatTextWithHighlights = (text: string) => {
    const parts = text.split(/(#\w+|@\w+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('#') || part.startsWith('@')) {
        return <span key={index} className="text-blue-500">{part}</span>;
      }
      return part;
    });
  };

  const moveContentStatus = (item: Content, direction: 'left' | 'right') => {
    const current = (item.contentStatus || 'idea') as ContentStatusStep;
    const idx = CONTENT_STATUS_STEPS.indexOf(current);
    const nextIdx = direction === 'right' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= CONTENT_STATUS_STEPS.length) return;
    const newStatus = CONTENT_STATUS_STEPS[nextIdx];
    const updates: Partial<Content> = { contentStatus: newStatus };
    if (newStatus === 'published') {
      updates.status = 'published';
      updates.publishedAt = new Date();
    }
    handleUpdatePost(item.id, updates);
    toast({ title: t('contentCalendar.movedTo', { status: t(`contentCalendar.${newStatus}`) }) });
  };

  const openEditModal = (item: Content) => {
    setSelectedPost(item);
    setFormData({
      title: item.title,
      body: item.body,
      platform: item.platform,
      contentType: item.contentType,
      pillar: item.pillar,
      goal: item.goal,
      contentStatus: item.contentStatus || 'idea',
      scheduledFor: item.scheduledFor ? new Date(item.scheduledFor) : undefined,
      mediaUrl: item.mediaUrl || undefined,
      mediaFileName: item.mediaFileName || undefined,
    });
    setShowCreateDialog(true);
  };

  const ContentCard = ({ item }: { item: Content }) => {
    const platform = getPlatformInfo(item.platform);
    const status = (item.contentStatus || 'idea') as ContentStatusStep;
    const statusIdx = CONTENT_STATUS_STEPS.indexOf(status);
    const canMoveLeft = statusIdx > 0;
    const canMoveRight = statusIdx < CONTENT_STATUS_STEPS.length - 1;

    return (
      <div
        className="group bg-white border border-slate-200 rounded-lg p-3 hover:shadow-md transition-all cursor-pointer relative"
        onClick={() => openEditModal(item)}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: platform.dotColor }} />
          <span className="text-xs text-slate-500">{platform.label}</span>
        </div>
        <h4 className="text-sm text-slate-900 line-clamp-1 mb-2">{item.title}</h4>
        <div className="flex items-center gap-2 flex-wrap">
          {item.pillar && (
            <span className="text-xs px-1.5 py-0.5 border border-slate-200 rounded text-slate-500">{item.pillar}</span>
          )}
          {item.scheduledFor && (
            <span className="text-xs text-slate-400">{format(new Date(item.scheduledFor), 'MMM d')}</span>
          )}
        </div>
        <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {canMoveLeft && (
            <button
              className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
              onClick={() => moveContentStatus(item, 'left')}
              title={`Move to ${CONTENT_STATUS_LABELS[CONTENT_STATUS_STEPS[statusIdx - 1]]}`}
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
            </button>
          )}
          {canMoveRight && (
            <button
              className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
              onClick={() => moveContentStatus(item, 'right')}
              title={`Move to ${CONTENT_STATUS_LABELS[CONTENT_STATUS_STEPS[statusIdx + 1]]}`}
            >
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            </button>
          )}
          <button
            className="w-6 h-6 rounded bg-red-50 hover:bg-red-100 flex items-center justify-center"
            onClick={() => deleteContentMutation.mutate(item.id)}
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      </div>
    );
  };

  const PipelineColumn = ({ status, items }: { status: ContentStatusStep; items: Content[] }) => (
    <div className="flex-1 min-w-[240px] bg-slate-50 rounded-lg border border-slate-200 flex flex-col max-h-full">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm text-slate-700">{t(`contentCalendar.${status}`)}</h3>
          <span className="text-xs bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">{items.length}</span>
        </div>
        {status === 'idea' && (
          <button
            className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90"
            onClick={() => {
              resetForm();
              setShowCreateDialog(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.map(item => <ContentCard key={item.id} item={item} />)}
        {items.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">{t('contentCalendar.noItems')}</p>
        )}
      </div>
    </div>
  );

  const renderCreateEditModal = () => (
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{selectedPost ? t('contentCalendar.editPost') : t('contentCalendar.createNewPost')}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-6 h-full">
        <div className="space-y-4">
          <div>
            <Label>{t('contentCalendar.editorialStatus')}</Label>
            <div className="flex gap-2 mt-1.5">
              {CONTENT_STATUS_STEPS.map(s => (
                <button
                  key={s}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    formData.contentStatus === s
                      ? CONTENT_STATUS_COLORS[s]
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                  onClick={() => setFormData(prev => ({ ...prev, contentStatus: s }))}
                >
                  {t(`contentCalendar.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {strategyReport && strategyReport.recommendations && strategyReport.recommendations.length > 0 && (
            <div className="border border-indigo-200 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-2 bg-indigo-50 hover:bg-indigo-100 transition-colors text-sm"
                onClick={() => setShowStrategyRecs(!showStrategyRecs)}
              >
                <span className="flex items-center gap-2 text-indigo-700">
                  <Lightbulb className="w-4 h-4" />
                  {t('contentCalendar.fromThisWeeksStrategy')}
                </span>
                <ChevronDown className={`w-4 h-4 text-indigo-500 transition-transform ${showStrategyRecs ? 'rotate-180' : ''}`} />
              </button>
              {showStrategyRecs && (
                <div className="p-2 space-y-1 bg-white">
                  {strategyReport.recommendations.map((rec, i) => (
                    <button
                      key={i}
                      className="w-full text-left px-3 py-2 text-sm rounded hover:bg-indigo-50 text-slate-700 transition-colors"
                      onClick={() => setFormData(prev => ({ ...prev, title: rec }))}
                    >
                      {rec}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="platform">{t('contentCalendar.platform')}</Label>
              <Select value={formData.platform} onValueChange={(value) => setFormData(prev => ({ ...prev, platform: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(platform => (
                    <SelectItem key={platform.value} value={platform.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${platform.color}`} />
                        {platform.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="contentType">{t('contentCalendar.contentType')}</Label>
              <Select value={formData.contentType} onValueChange={(value) => setFormData(prev => ({ ...prev, contentType: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>{
                      type.value === 'post' ? t('contentCalendar.socialPost') :
                      type.value === 'story' ? t('contentCalendar.story') :
                      type.value === 'email' ? t('contentCalendar.email') :
                      t('contentCalendar.article')
                    }</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="goal">{t('contentCalendar.goal')}</Label>
              <Select value={formData.goal} onValueChange={(value) => setFormData(prev => ({ ...prev, goal: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOALS.map(goal => (
                    <SelectItem key={goal.value} value={goal.value}>{
                      goal.value === 'visibility' ? t('contentCalendar.visibility') :
                      goal.value === 'trust' ? t('contentCalendar.trustBuilding') :
                      goal.value === 'conversion' ? t('contentCalendar.conversion') :
                      t('contentCalendar.engagement')
                    }</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pillar">{t('contentCalendar.contentPillar')}</Label>
              <Input
                placeholder={t('contentCalendar.contentPillarPlaceholder')}
                value={formData.pillar}
                onChange={(e) => setFormData(prev => ({ ...prev, pillar: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="title">{t('contentCalendar.titleCaption')}</Label>
            <Input
              placeholder={t('contentCalendar.titleCaptionPlaceholder')}
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            />
          </div>

          {(() => {
            const userPersona = (personaResult?.analysisResult as Record<string, string>)?.personaName;
            const targetPersona = targetPersonas[0];
            if (!userPersona && !targetPersona) return null;
            return (
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3 text-xs space-y-1">
                <p className="font-semibold text-purple-700 dark:text-purple-300">{t('contentCalendar.personaContext')}</p>
                {userPersona && <p className="text-slate-600 dark:text-gray-300">{t('contentCalendar.yourArchetype')} <span className="font-medium">{userPersona}</span></p>}
                {targetPersona && (
                  <>
                    <p className="text-slate-600 dark:text-gray-300">{t('contentCalendar.targetPersonaLabel')} <span className="font-medium">{targetPersona.name}</span></p>
                    {targetPersona.decisionTriggers?.[0] && (
                      <p className="text-slate-500 dark:text-gray-400">{t('contentCalendar.decisionTrigger')} {targetPersona.decisionTriggers[0]}</p>
                    )}
                  </>
                )}
                <p className="text-purple-600 dark:text-purple-400">{t('contentCalendar.aiAdaptMessage')}</p>
              </div>
            );
          })()}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="body">{t('contentCalendar.contentLabel')}</Label>
              <Button variant="outline" size="sm" onClick={handleGenerateContent} disabled={generateContentMutation.isPending}>
                {generateContentMutation.isPending ? t('common.generating') : (
                  <><Sparkles className="w-3.5 h-3.5 mr-1" /> {t('contentCalendar.aiGenerate')}</>
                )}
              </Button>
            </div>
            <Textarea
              placeholder={t('contentCalendar.writePlaceholder')}
              value={formData.body}
              onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
              rows={6}
            />
            {formData.platform && (
              <div className="flex justify-between items-center mt-1 text-xs">
                <div className="text-gray-500">{t('contentCalendar.mentionTip')}</div>
                {(() => {
                  const platform = getPlatformInfo(formData.platform);
                  const count = getCharacterCount(formData.body);
                  const status = getCharacterStatus(count, platform.charLimit);
                  return (
                    <div className={`font-medium ${status.color}`}>
                      {count}/{platform.charLimit}
                      {status.status === 'error' && <span className="ml-1">{t('contentCalendar.tooLong')}</span>}
                      {status.status === 'warning' && <span className="ml-1">{t('contentCalendar.almostLimit')}</span>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="media">{t('contentCalendar.mediaOptional')}</Label>
            <div className="mt-2 space-y-3">
              {formData.mediaUrl ? (
                <div className="relative border-2 border-green-200 bg-green-50 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <Image className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm text-green-900">{formData.mediaFileName || t('contentCalendar.uploadedMedia')}</p>
                        <p className="text-xs text-green-600">{t('contentCalendar.mediaUploadedLabel')}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setFormData(prev => ({ ...prev, mediaUrl: undefined, mediaFileName: undefined }))} className="text-green-700 hover:text-green-900">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-gray-400 transition-colors">
                  <div className="text-gray-500 mb-3">
                    <Image className="mx-auto h-8 w-8 mb-2" />
                    <p className="text-sm">{t('contentCalendar.uploadImagesOrVideos')}</p>
                    <p className="text-xs text-gray-400 mt-1">{t('contentCalendar.fileFormats')}</p>
                  </div>
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    maxFileSize={10485760}
                    onGetUploadParameters={handleGetUploadParameters}
                    onComplete={handlePostMediaUpload}
                    buttonClassName="mx-auto"
                  >
                    <div className="flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      {t('contentCalendar.uploadMedia')}
                    </div>
                  </ObjectUploader>
                </div>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="scheduledFor">{t('contentCalendar.scheduleDateAndTime')}</Label>
            <Input
              type="datetime-local"
              value={formData.scheduledFor && formData.scheduledFor instanceof Date && !isNaN(formData.scheduledFor.getTime()) ? format(formData.scheduledFor, "yyyy-MM-dd'T'HH:mm") : ''}
              onChange={(e) => {
                try {
                  setFormData(prev => ({ ...prev, scheduledFor: e.target.value ? new Date(e.target.value) : undefined }));
                } catch {
                  console.error('Invalid date value:', e.target.value);
                }
              }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>{t('common.cancel')}</Button>
            {selectedPost ? (
              <Button
                onClick={() => {
                  updateContentMutation.mutate({
                    id: selectedPost.id,
                    data: {
                      title: formData.title,
                      body: formData.body,
                      platform: formData.platform,
                      contentType: formData.contentType,
                      pillar: formData.pillar,
                      goal: formData.goal,
                      contentStatus: formData.contentStatus,
                      scheduledFor: formData.scheduledFor,
                      mediaUrl: formData.mediaUrl || null,
                      mediaFileName: formData.mediaFileName || null,
                    },
                  });
                  setShowCreateDialog(false);
                  resetForm();
                }}
                disabled={updateContentMutation.isPending}
              >
                {updateContentMutation.isPending ? t('contentCalendar.updating') : t('contentCalendar.updatePost')}
              </Button>
            ) : (
              <>
                <Button onClick={handleCreatePost} disabled={createContentMutation.isPending}>
                  {createContentMutation.isPending ? t('contentCalendar.creating') : t('common.save')}
                </Button>
                <Button
                  onClick={handleCreateAndPublish}
                  disabled={createContentMutation.isPending || publishContentMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {publishContentMutation.isPending ? t('contentCalendar.publishing') : t('contentCalendar.publishNow')}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="bg-slate-50 rounded-lg p-4">
          <div className="sticky top-0 bg-slate-50 pb-4 border-b border-slate-200 mb-4">
            <h3 className="text-lg text-slate-900">{t('contentCalendar.preview')}</h3>
            <p className="text-sm text-slate-600">{t('contentCalendar.previewDescription', { platform: getPlatformInfo(formData.platform).label })}</p>
          </div>
          <div className="space-y-4">
            {formData.platform === 'instagram' && (
              <div className="bg-white rounded-lg border border-gray-200 max-w-sm mx-auto">
                <div className="flex items-center p-3 border-b border-gray-200">
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm">B</span>
                  </div>
                  <div className="ml-3">
                    <div className="font-semibold text-sm">your_business</div>
                    <div className="text-xs text-gray-500">{t('contentCalendar.sponsored')}</div>
                  </div>
                </div>
                <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative">
                  {formData.mediaUrl ? (
                    <img src={formData.mediaUrl} alt="Post preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-gray-400 text-center">
                      <p className="text-xs">{t('contentCalendar.yourMediaWillAppear')}</p>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-4 mb-3 text-xl">
                    <span>❤️</span><span>💬</span><span>📤</span>
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold">your_business</span>
                    <span className="ml-1">{formData.body ? formatTextWithHighlights(formData.body) : t('contentCalendar.yourCaptionWillAppear')}</span>
                  </div>
                </div>
              </div>
            )}
            {formData.platform === 'linkedin' && (
              <div className="bg-white rounded-lg border border-gray-200 max-w-lg mx-auto">
                <div className="flex items-center p-4 border-b border-gray-200">
                  <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                    <span className="text-white">B</span>
                  </div>
                  <div className="ml-3">
                    <div className="font-semibold text-sm">Your Business</div>
                    <div className="text-xs text-gray-500">1,234 followers • 2h</div>
                  </div>
                </div>
                <div className="p-4">
                  {formData.title && <h3 className="font-semibold text-lg mb-2">{formData.title}</h3>}
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">
                    {formData.body ? formatTextWithHighlights(formData.body) : t('contentCalendar.linkedinPostPlaceholder')}
                  </div>
                </div>
                <div className="flex items-center justify-around py-3 border-t border-gray-200">
                  <button className="flex items-center gap-2 text-sm text-gray-600"><span>👍</span> {t('contentCalendar.like')}</button>
                  <button className="flex items-center gap-2 text-sm text-gray-600"><span>💬</span> {t('contentCalendar.comment')}</button>
                  <button className="flex items-center gap-2 text-sm text-gray-600"><span>🔄</span> {t('contentCalendar.repost')}</button>
                </div>
              </div>
            )}
            {formData.platform === 'twitter' && (
              <div className="bg-white rounded-lg border border-gray-200 max-w-lg mx-auto">
                <div className="flex items-start p-4">
                  <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center mr-3">
                    <span className="text-white">B</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-sm">Your Business</span>
                      <span className="text-blue-500">✓</span>
                      <span className="text-gray-500 text-sm">@yourbusiness • 2h</span>
                    </div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">
                      {formData.body ? formatTextWithHighlights(formData.body) : t('contentCalendar.tweetPlaceholder')}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {(!formData.platform || !['instagram', 'linkedin', 'twitter', 'facebook'].includes(formData.platform)) && (
              <div className="text-center py-8 text-gray-500">
                <p>{t('contentCalendar.selectPlatformPreview')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogContent>
  );

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t('contentCalendar.title')}{selectedProject ? ` — ${selectedProject.name}` : ''}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">{t('contentCalendar.subtitle')}</p>
            </div>
            <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  {t('contentCalendar.newPiece')}
                </Button>
              </DialogTrigger>
              {renderCreateEditModal()}
            </Dialog>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {projects.slice(0, 5).map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedProjectId === p.id
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {projects.length > 5 && (
                <select
                  className="px-2 py-1 text-sm rounded-lg border border-slate-200 bg-white text-slate-700"
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

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-slate-200 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-slate-500" />
                  <Input
                    placeholder={t('contentCalendar.searchPosts')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-64"
                  />
                </div>
              </div>

              <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
                <TabsList>
                  <TabsTrigger value="pipeline" className="flex items-center gap-2">
                    <List className="h-4 w-4" />
                    {t('contentCalendar.pipeline')}
                  </TabsTrigger>
                  <TabsTrigger value="calendar" className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {t('contentCalendar.calendar')}
                  </TabsTrigger>
                  <TabsTrigger value="accounts" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    {t('contentCalendar.accounts')}
                  </TabsTrigger>
                  <TabsTrigger value="media" className="flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    {t('contentCalendar.mediaUrl')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <main className="flex-1 overflow-hidden">
            {view === 'pipeline' ? (
              <div className="h-full p-6">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                  </div>
                ) : (
                  <div className="flex gap-4 h-full overflow-x-auto">
                    {CONTENT_STATUS_STEPS.map(status => {
                      const items = filteredContent.filter(c => (c.contentStatus || 'idea') === status);
                      return <PipelineColumn key={status} status={status} items={items} />;
                    })}
                  </div>
                )}
              </div>
            ) : view === 'calendar' ? (
              <div className="h-full p-6">
                <div className="h-full bg-white rounded-lg border border-slate-200 p-4">
                  <DragAndDropCalendar
                    localizer={localizer}
                    events={events}
                    startAccessor={(event: object) => (event as ContentEvent).start}
                    endAccessor={(event: object) => (event as ContentEvent).end}
                    style={{ height: '100%' }}
                    onSelectEvent={(event: object) => handleSelectEvent(event as ContentEvent)}
                    onEventDrop={handleEventDrop as any}
                    onEventResize={handleEventResize as any}
                    onSelectSlot={handleSelectSlot as any}
                    selectable
                    resizable
                    draggableAccessor={() => true}
                    resizableAccessor={() => true}
                    eventPropGetter={(event: object) => {
                      const ce = event as ContentEvent;
                      const platform = getPlatformInfo(ce.resource.platform);
                      return {
                        style: {
                          backgroundColor: platform.dotColor,
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '12px',
                          color: 'white' as const,
                          cursor: 'move' as const,
                        },
                      };
                    }}
                    components={{
                      event: ({ event }: { event: object }) => {
                        const ce = event as ContentEvent;
                        return (
                          <div className="text-xs p-1">
                            <div className="font-medium truncate">{ce.title}</div>
                            <div className="text-xs opacity-75">{ce.resource.platform}</div>
                          </div>
                        );
                      },
                    }}
                  />
                </div>
              </div>
            ) : view === 'accounts' ? (
              <div className="p-6 h-full overflow-y-auto">
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl text-slate-900 mb-2">{t('contentCalendar.socialMediaAccounts')}</h2>
                    <p className="text-slate-600">{t('contentCalendar.socialMediaAccountsDescription')}</p>
                    <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-start gap-3">
                        <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center mt-0.5">
                          <span className="text-white text-xs">!</span>
                        </div>
                        <div>
                          <h4 className="font-medium text-amber-900 mb-1">{t('contentCalendar.demoModeActive')}</h4>
                          <p className="text-amber-800 text-sm">{t('contentCalendar.demoModeDescription')}</p>
                          <details className="mt-2">
                            <summary className="text-amber-700 text-sm cursor-pointer hover:text-amber-900">{t('contentCalendar.setupInstructions')}</summary>
                            <div className="mt-2 text-sm text-amber-700 space-y-2">
                              <p><strong>LinkedIn:</strong> Create an app at developer.linkedin.com</p>
                              <p><strong>Instagram:</strong> Set up Facebook App with Instagram Basic Display API</p>
                              <p><strong>Twitter:</strong> Create app at developer.twitter.com with OAuth 2.0 enabled</p>
                              <p><strong>Facebook:</strong> Create app at developers.facebook.com with Pages permissions</p>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {PLATFORMS.filter(p => ['instagram', 'linkedin', 'twitter', 'facebook'].includes(p.value)).map(platform => {
                      const connectedAccount = socialAccounts.find((acc: SocialAccount) => acc.platform === platform.value);
                      const isConnected = !!connectedAccount;
                      return (
                        <Card key={platform.value} className="relative">
                          <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg ${platform.color} flex items-center justify-center text-white text-lg`}>
                                  {platform.label[0]}
                                </div>
                                <div>
                                  <CardTitle className="text-lg">{platform.label}</CardTitle>
                                  <p className="text-sm text-slate-500 mt-1">{isConnected ? t('contentCalendar.connected') : t('contentCalendar.notConnected')}</p>
                                </div>
                              </div>
                              {isConnected ? <Check className="h-5 w-5 text-green-600" /> : <X className="h-5 w-5 text-slate-400" />}
                            </div>
                          </CardHeader>
                          <CardContent>
                            {isConnected ? (
                              <div className="space-y-3">
                                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                                  <div className="flex items-center gap-2 text-green-800">
                                    <Check className="h-4 w-4" />
                                    <span className="text-sm">{t('contentCalendar.accountConnectedLabel')}</span>
                                  </div>
                                  <p className="text-green-700 text-sm mt-1">{connectedAccount.accountName}</p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => disconnectAccountMutation.mutate(connectedAccount.id)}
                                  disabled={disconnectAccountMutation.isPending}
                                  className="w-full text-red-600 border-red-200 hover:bg-red-50"
                                  data-testid={`disconnect-${platform.value}`}
                                >
                                  {disconnectAccountMutation.isPending ? t('contentCalendar.disconnecting') : t('contentCalendar.disconnect')}
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                                  <p className="text-slate-600 text-sm">{t('contentCalendar.connectTo', { platform: platform.label })}</p>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => handleConnectAccount(platform.value)}
                                  disabled={connectAccountMutation.isPending}
                                  className="w-full bg-slate-600 hover:bg-slate-700"
                                  data-testid={`connect-${platform.value}`}
                                >
                                  {connectAccountMutation.isPending ? t('contentCalendar.connecting') : t('contentCalendar.connectDemo', { platform: platform.label })}
                                  <ExternalLink className="h-4 w-4 ml-2" />
                                </Button>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h3 className="font-medium text-slate-900 mb-2">{t('contentCalendar.connectionStatus')}</h3>
                    <div className="flex items-center gap-4 text-sm text-slate-600">
                      <span>{t('contentCalendar.connectedCount', { count: socialAccounts.length })}</span>
                      <span>•</span>
                      <span>{t('contentCalendar.readyForPosting')}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 h-full overflow-y-auto">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl text-slate-900 mb-2">{t('contentCalendar.mediaLibrary')}</h2>
                      <p className="text-slate-600">{t('contentCalendar.mediaLibraryDescription')}</p>
                    </div>
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={10485760}
                      onGetUploadParameters={handleGetUploadParameters}
                      onComplete={handleUploadComplete}
                      buttonClassName="flex items-center gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      {t('contentCalendar.uploadMedia')}
                    </ObjectUploader>
                  </div>
                  {mediaLoading ? (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto" />
                      <p className="text-slate-600 mt-2">{t('contentCalendar.loadingMedia')}</p>
                    </div>
                  ) : mediaLibrary.length === 0 ? (
                    <div className="text-center py-12">
                      <Image className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                      <h3 className="text-lg text-slate-900 mb-2">{t('contentCalendar.noMediaFiles')}</h3>
                      <p className="text-slate-600 mb-4">{t('contentCalendar.noMediaDescription')}</p>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={10485760}
                        onGetUploadParameters={handleGetUploadParameters}
                        onComplete={handleUploadComplete}
                        buttonClassName="mx-auto"
                      >
                        <div className="flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          {t('contentCalendar.uploadFirstMedia')}
                        </div>
                      </ObjectUploader>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {mediaLibrary.map((media: MediaLibrary) => {
                        const isImage = media.mimeType?.startsWith('image/');
                        const isVideo = media.mimeType?.startsWith('video/');
                        return (
                          <Card key={media.id} className="group relative overflow-hidden hover:shadow-lg transition-all">
                            <div className="aspect-square relative bg-slate-100">
                              {isImage ? (
                                <img src={media.url} alt={media.filename} className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              ) : isVideo ? (
                                <video src={media.url} className="w-full h-full object-cover" muted
                                  onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; }} />
                              ) : null}
                              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <div className="flex gap-2">
                                  <Button size="sm" variant="secondary" className="bg-white text-slate-900 hover:bg-slate-100"
                                    onClick={() => window.open(media.url, '_blank')} data-testid={`view-media-${media.id}`}>
                                    <ExternalLink className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="destructive" onClick={() => handleDeleteMedia(media.id)}
                                    disabled={deleteMediaMutation.isPending} data-testid={`delete-media-${media.id}`}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              {isVideo && (
                                <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">VIDEO</div>
                              )}
                            </div>
                            <CardContent className="p-3">
                              <div className="space-y-1">
                                <p className="text-sm text-slate-900 truncate" title={media.filename}>{media.filename}</p>
                                <div className="flex items-center justify-between text-xs text-slate-500">
                                  <span>{media.mimeType}</span>
                                  <span>{formatFileSize(media.size)}</span>
                                </div>
                                <p className="text-xs text-slate-400">
                                  {media.createdAt ? format(new Date(media.createdAt), 'MMM d, yyyy') : t('contentCalendar.unknownDate')}
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                  {mediaLibrary.length > 0 && (
                    <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <h3 className="font-medium text-slate-900 mb-2">{t('contentCalendar.libraryStats')}</h3>
                      <div className="flex items-center gap-4 text-sm text-slate-600">
                        <span>{t('contentCalendar.totalFiles', { count: mediaLibrary.length })}</span>
                        <span>•</span>
                        <span>{t('contentCalendar.images', { count: mediaLibrary.filter((m: MediaLibrary) => m.mimeType?.startsWith('image/')).length })}</span>
                        <span>•</span>
                        <span>{t('contentCalendar.videos', { count: mediaLibrary.filter((m: MediaLibrary) => m.mimeType?.startsWith('video/')).length })}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
