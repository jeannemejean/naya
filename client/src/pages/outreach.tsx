import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Sidebar from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, MoreHorizontal, Mail, Building, Calendar, TrendingUp, Users, Target, Filter } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Lead } from '@shared/schema';

interface OutreachProps {
  onSearchClick?: () => void;
}

const PIPELINE_STAGES = [
  { id: 'discovered', label: 'Discovered', color: 'bg-gray-100 text-gray-800' },
  { id: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-800' },
  { id: 'warm', label: 'Warm', color: 'bg-orange-100 text-orange-800' },
  { id: 'follow_up', label: 'Follow Up', color: 'bg-purple-100 text-purple-800' },
  { id: 'client', label: 'Client', color: 'bg-green-100 text-green-800' },
];

const SCORE_COLORS = {
  hot: 'bg-red-100 text-red-800',
  warm: 'bg-orange-100 text-orange-800',
  cold: 'bg-blue-100 text-blue-800',
};

export default function Outreach({ onSearchClick }: OutreachProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedScore, setSelectedScore] = useState<string>('all');
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch leads
  const { data: leads = [], isLoading, error } = useQuery<Lead[]>({
    queryKey: ['/api/leads'],
  });

  // Show error state if authentication or other issues
  if (error) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar onSearchClick={onSearchClick} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-sm">!</span>
            </div>
            <h3 className="text-lg text-slate-900 dark:text-white mb-2">{t('outreach.unableToLoad')}</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              {(error as any)?.status === 401 
                ? t('outreach.pleaseLogIn')
                : t('outreach.problemLoading')}
            </p>
            <Button 
              onClick={() => window.location.href = "/api/login"}
              className="bg-primary hover:bg-primary/90"
            >
              {(error as any)?.status === 401 ? t('outreach.logIn') : t('common.retry')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Move lead to different stage
  const updateLeadStatus = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: number; status: string }) => {
      return apiRequest('PATCH', `/api/leads/${leadId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: t('outreach.leadUpdated'),
        description: t('outreach.leadUpdatedDescription'),
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('outreach.failedToUpdate'),
        variant: "destructive",
      });
    },
  });

  // Filter leads
  const filteredLeads = leads.filter((lead: Lead) => {
    const matchesSearch = searchTerm === '' || 
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.company && lead.company.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (lead.email && lead.email.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesScore = selectedScore === 'all' || selectedScore === '' || lead.score === selectedScore;
    
    return matchesSearch && matchesScore;
  });

  // Group leads by status
  const leadsByStatus = PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage.id] = filteredLeads.filter((lead: Lead) => lead.status === stage.id);
    return acc;
  }, {} as Record<string, Lead[]>);

  // Calculate metrics
  const totalLeads = leads.length;
  const hotLeads = leads.filter((lead: Lead) => lead.score === 'hot').length;
  const conversionRate = totalLeads > 0 ? Math.round((leadsByStatus.client?.length || 0) / totalLeads * 100) : 0;
  const activeDeals = leadsByStatus.warm?.length + leadsByStatus.follow_up?.length || 0;

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (draggedLead && draggedLead.status !== newStatus) {
      updateLeadStatus.mutate({
        leadId: draggedLead.id,
        status: newStatus,
      });
    }
    setDraggedLead(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar onSearchClick={onSearchClick} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-sm">N</span>
            </div>
            <p className="text-slate-600">{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('outreach.title')}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('outreach.subtitle')}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Dialog open={isAddLeadOpen} onOpenChange={setIsAddLeadOpen}>
                <DialogTrigger asChild>
                  <Button className="flex items-center space-x-2" data-testid="button-add-lead">
                    <Plus className="w-4 h-4" />
                    <span>{t('outreach.addLead')}</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('outreach.addLead')}</DialogTitle>
                  </DialogHeader>
                  <AddLeadForm onClose={() => setIsAddLeadOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>

        {/* Metrics Dashboard */}
        <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{t('outreach.leadName')}s</p>
                <p className="text-xl text-slate-900 dark:text-white" data-testid="metric-total-leads">{totalLeads}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                <TrendingUp className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{t('outreach.hot')}</p>
                <p className="text-xl text-slate-900 dark:text-white" data-testid="metric-hot-leads">{hotLeads}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                <Target className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{t('analytics.completionRate')}</p>
                <p className="text-xl text-slate-900 dark:text-white" data-testid="metric-conversion-rate">{conversionRate}%</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <Building className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{t('campaigns.active')}</p>
                <p className="text-xl text-slate-900 dark:text-white" data-testid="metric-active-deals">{activeDeals}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3">
          <div className="flex items-center space-x-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder={t('outreach.searchLeads')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-leads"
              />
            </div>
            <Select value={selectedScore} onValueChange={setSelectedScore}>
              <SelectTrigger className="w-40" data-testid="select-score-filter">
                <SelectValue placeholder={t('outreach.filterByScore')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('outreach.filterByScore')}</SelectItem>
                <SelectItem value="hot">{t('outreach.hot')}</SelectItem>
                <SelectItem value="warm">{t('outreach.warm')}</SelectItem>
                <SelectItem value="cold">{t('outreach.cold')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Pipeline Kanban Board */}
        <main className="flex-1 overflow-hidden p-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full">
            {PIPELINE_STAGES.map((stage) => (
              <div
                key={stage.id}
                className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{stage.label}</h3>
                    <Badge variant="secondary" className={stage.color}>
                      {leadsByStatus[stage.id]?.length || 0}
                    </Badge>
                  </div>
                </div>
                <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                  {leadsByStatus[stage.id]?.map((lead: Lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onDragStart={(e) => handleDragStart(e, lead)}
                    />
                  ))}
                  {leadsByStatus[stage.id]?.length === 0 && (
                    <div className="text-center text-slate-400 dark:text-slate-500 py-8">
                      <p className="text-sm">{t('outreach.discovered')}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

// Lead Card Component
function LeadCard({ lead, onDragStart }: { lead: Lead; onDragStart: (e: React.DragEvent) => void }) {
  return (
    <Card
      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      draggable
      onDragStart={onDragStart}
      data-testid={`card-lead-${lead.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start space-x-3">
          <Avatar className="w-10 h-10">
            <AvatarFallback className="text-xs">
              {lead.name.split(' ').map(n => n[0]).join('').toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm text-slate-900 dark:text-white truncate" data-testid={`text-lead-name-${lead.id}`}>
              {lead.name}
            </h4>
            {lead.company && (
              <p className="text-xs text-slate-600 dark:text-slate-400 truncate" data-testid={`text-lead-company-${lead.id}`}>
                {lead.company}
              </p>
            )}
            <div className="flex items-center space-x-2 mt-2">
              <Badge variant="outline" className={`text-xs ${SCORE_COLORS[lead.score as keyof typeof SCORE_COLORS]}`}>
                {lead.score}
              </Badge>
              {lead.platform && (
                <Badge variant="outline" className="text-xs">
                  {lead.platform}
                </Badge>
              )}
            </div>
            {lead.lastContactDate && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {new Date(lead.lastContactDate).toLocaleDateString()}
              </p>
            )}
          </div>
          <button className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
            <MoreHorizontal className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// Add Lead Form Component  
function AddLeadForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    platform: '',
    status: 'discovered',
    score: 'cold',
    notes: '',
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const addLead = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/leads', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: t('outreach.addLead'),
        description: t('outreach.leadUpdatedDescription'),
      });
      onClose();
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('outreach.failedToUpdate'),
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({
        title: t('common.error'),
        description: t('outreach.leadName'),
        variant: "destructive",
      });
      return;
    }
    addLead.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-slate-700 dark:text-slate-300">{t('outreach.leadName')} *</label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t('outreach.leadName')}
          required
          data-testid="input-lead-name"
        />
      </div>
      <div>
        <label className="text-sm text-slate-700 dark:text-slate-300">{t('outreach.leadEmail')}</label>
        <Input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="lead@company.com"
          data-testid="input-lead-email"
        />
      </div>
      <div>
        <label className="text-sm text-slate-700 dark:text-slate-300">{t('outreach.leadCompany')}</label>
        <Input
          value={formData.company}
          onChange={(e) => setFormData({ ...formData, company: e.target.value })}
          placeholder={t('outreach.leadCompany')}
          data-testid="input-lead-company"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-700 dark:text-slate-300">{t('contentCalendar.platform')}</label>
          <Select value={formData.platform} onValueChange={(value) => setFormData({ ...formData, platform: value })}>
            <SelectTrigger data-testid="select-lead-platform">
              <SelectValue placeholder={t('contentCalendar.platform')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm text-slate-700 dark:text-slate-300">{t('outreach.leadScore')}</label>
          <Select value={formData.score} onValueChange={(value) => setFormData({ ...formData, score: value })}>
            <SelectTrigger data-testid="select-lead-score">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm text-slate-700 dark:text-slate-300">{t('readingHub.articleNotes')}</label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes about this lead..."
          rows={3}
          data-testid="textarea-lead-notes"
        />
      </div>
      <div className="flex justify-end space-x-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-lead">
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={addLead.isPending} data-testid="button-save-lead">
          {addLead.isPending ? t('common.loading') : t('outreach.addLead')}
        </Button>
      </div>
    </form>
  );
}