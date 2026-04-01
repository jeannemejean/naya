import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, FileText, CheckSquare, Users, Calendar, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useLocation } from 'wouter';
import type { Task, Content, Lead } from '@shared/schema';

interface SearchResult {
  id: string;
  type: 'task' | 'content' | 'lead' | 'strategy';
  title: string;
  description: string;
  status?: string;
  platform?: string;
  relevance: number;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const RESULT_TYPES = {
    task: { label: t('globalSearch.tasks'), icon: CheckSquare, color: 'bg-blue-500' },
    content: { label: t('globalSearch.content'), icon: FileText, color: 'bg-green-500' },
    lead: { label: t('globalSearch.leads'), icon: Users, color: 'bg-purple-500' },
    strategy: { label: t('globalSearch.strategy'), icon: BarChart3, color: 'bg-orange-500' },
  };

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
    enabled: open,
  });

  const { data: content = [] } = useQuery<Content[]>({
    queryKey: ['/api/content'],
    enabled: open,
  });

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ['/api/leads'],
    enabled: open,
  });

  const searchResults = useMemo(() => {
    if (!query) return [];

    const results: SearchResult[] = [];
    const lowQuery = query.toLowerCase();

    tasks.forEach((task) => {
      const relevance = calculateRelevance(task.title, task.description || '', lowQuery);
      if (relevance > 0) {
        results.push({
          id: `task-${task.id}`,
          type: 'task',
          title: task.title,
          description: task.description || `${task.type} • ${task.category}`,
          status: task.completed ? 'completed' : 'pending',
          relevance,
          url: '/',
          icon: CheckSquare,
        });
      }
    });

    content.forEach((item) => {
      const relevance = calculateRelevance(item.title, item.body, lowQuery);
      if (relevance > 0) {
        results.push({
          id: `content-${item.id}`,
          type: 'content',
          title: item.title,
          description: item.body.substring(0, 100) + '...',
          status: item.status,
          platform: item.platform,
          relevance,
          url: '/content-calendar',
          icon: FileText,
        });
      }
    });

    leads.forEach((lead) => {
      const relevance = calculateRelevance(lead.name, lead.company || '', lowQuery) +
                       calculateRelevance(lead.email || '', lead.notes || '', lowQuery);
      if (relevance > 0) {
        results.push({
          id: `lead-${lead.id}`,
          type: 'lead',
          title: lead.name,
          description: `${lead.company || 'Unknown Company'} • ${lead.email || 'No email'}`,
          status: lead.status,
          relevance,
          url: '/outreach',
          icon: Users,
        });
      }
    });

    return results
      .sort((a, b) => b.relevance - a.relevance)
      .filter(result => !selectedType || result.type === selectedType)
      .slice(0, 50);
  }, [query, tasks, content, leads, selectedType]);

  function calculateRelevance(title: string, description: string, query: string): number {
    const titleLower = title.toLowerCase();
    const descLower = description.toLowerCase();
    
    let score = 0;
    
    if (titleLower.includes(query)) {
      score += 100;
    }
    
    const titleWords = titleLower.split(' ');
    const queryWords = query.split(' ');
    queryWords.forEach(word => {
      if (titleWords.some(titleWord => titleWord.includes(word))) {
        score += 50;
      }
    });
    
    if (descLower.includes(query)) {
      score += 25;
    }
    
    queryWords.forEach(word => {
      if (descLower.includes(word)) {
        score += 10;
      }
    });
    
    return score;
  }

  const handleResultClick = (result: SearchResult) => {
    setLocation(result.url);
    onOpenChange(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onOpenChange(false);
      setQuery('');
    }
  };

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedType(null);
    }
  }, [open]);

  const groupedResults = searchResults.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = [];
    }
    acc[result.type].push(result);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] p-0" data-testid="global-search-dialog">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t('globalSearch.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t('globalSearch.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-10 pr-10"
              autoFocus
              data-testid="search-input"
            />
            {query && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setQuery('')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {query && (
            <div className="flex gap-2 mt-4">
              <Button
                variant={selectedType === null ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedType(null)}
              >
                {t('common.all')} ({searchResults.length})
              </Button>
              {Object.entries(RESULT_TYPES).map(([type, config]) => {
                const count = groupedResults[type]?.length || 0;
                if (count === 0) return null;
                
                return (
                  <Button
                    key={type}
                    variant={selectedType === type ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedType(type)}
                    className="flex items-center gap-1"
                  >
                    <config.icon className="h-3 w-3" />
                    {config.label} ({count})
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 px-6 pb-6">
          {!query ? (
            <div className="text-center py-12">
              <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg text-gray-900 dark:text-white mb-2">
                {t('globalSearch.searchEverything')}
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                {t('globalSearch.searchEverythingDescription')}
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="text-center py-12">
              <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg text-gray-900 dark:text-white mb-2">
                {t('globalSearch.noResults')}
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                {t('globalSearch.tryDifferent')}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedResults).map(([type, results]) => {
                const config = RESULT_TYPES[type as keyof typeof RESULT_TYPES];
                if (!results.length) return null;

                return (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-3 h-3 rounded-full ${config.color}`} />
                      <h4 className="font-medium text-gray-900 dark:text-white">
                        {config.label} ({results.length})
                      </h4>
                    </div>
                    
                    <div className="space-y-2">
                      {results.map((result) => (
                        <div
                          key={result.id}
                          className="p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                          onClick={() => handleResultClick(result)}
                          data-testid={`search-result-${result.type}`}
                        >
                          <div className="flex items-start gap-3">
                            <result.icon className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <h5 className="font-medium text-gray-900 dark:text-white truncate">
                                {result.title}
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                                {result.description}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                {result.status && (
                                  <Badge variant="outline" className="text-xs">
                                    {result.status}
                                  </Badge>
                                )}
                                {result.platform && (
                                  <Badge variant="secondary" className="text-xs">
                                    {result.platform}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {type !== Object.keys(groupedResults)[Object.keys(groupedResults).length - 1] && (
                      <Separator className="mt-4" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}