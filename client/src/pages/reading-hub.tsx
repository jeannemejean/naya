import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Filter, BookOpen, ExternalLink, Heart, Eye, Trash2, Tags, Clock } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import type { SavedArticle } from '@shared/schema';

interface ReadingHubProps {
  onSearchClick?: () => void;
}

interface AddArticleFormData {
  title: string;
  url: string;
  description: string;
  author: string;
  source: string;
  category: string;
  tags: string[];
  notes: string;
}

const CATEGORIES = [
  { value: 'all', label: 'All Articles' },
  { value: 'industry-news', label: 'Industry News' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'inspiration', label: 'Inspiration' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'business', label: 'Business' },
  { value: 'technology', label: 'Technology' },
];

export default function ReadingHub({ onSearchClick }: ReadingHubProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [formData, setFormData] = useState<AddArticleFormData>({
    title: '',
    url: '',
    description: '',
    author: '',
    source: '',
    category: 'strategy',
    tags: [],
    notes: '',
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch saved articles
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['/api/saved-articles', selectedCategory],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') {
        params.append('category', selectedCategory);
      }
      return fetch(`/api/saved-articles?${params}`).then(res => res.json());
    },
  });

  // Create article mutation
  const createArticleMutation = useMutation({
    mutationFn: (data: AddArticleFormData) =>
      fetch('/api/saved-articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-articles'] });
      setShowAddDialog(false);
      resetForm();
      toast({ title: t('readingHub.articleSaved') });
    },
    onError: () => {
      toast({ title: t('readingHub.failedToSave'), variant: 'destructive' });
    },
  });

  // Delete article mutation
  const deleteArticleMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/saved-articles/${id}`, {
        method: 'DELETE',
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-articles'] });
      toast({ title: t('readingHub.articleDeleted') });
    },
    onError: () => {
      toast({ title: t('common.error'), variant: 'destructive' });
    },
  });

  // Toggle read status mutation
  const toggleReadMutation = useMutation({
    mutationFn: ({ id, isRead }: { id: number; isRead: boolean }) =>
      fetch(`/api/saved-articles/${id}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead }),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-articles'] });
    },
  });

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }: { id: number; isFavorite: boolean }) =>
      fetch(`/api/saved-articles/${id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite }),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-articles'] });
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      url: '',
      description: '',
      author: '',
      source: '',
      category: 'strategy',
      tags: [],
      notes: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createArticleMutation.mutate(formData);
  };

  // Filter articles based on search and filters
  const filteredArticles = articles.filter((article: SavedArticle) => {
    const matchesSearch = !searchQuery || 
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.author?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesUnread = !showUnreadOnly || !article.isRead;
    const matchesFavorites = !showFavoritesOnly || article.isFavorite;
    
    return matchesSearch && matchesUnread && matchesFavorites;
  });

  const unreadCount = articles.filter((article: SavedArticle) => !article.isRead).length;
  const favoriteCount = articles.filter((article: SavedArticle) => article.isFavorite).length;

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white dark:bg-card border-b border-border px-6 py-4 relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #6C5CE7, #a78bfa, #fd79a8, #fdcb6e)' }} />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t('readingHub.title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('readingHub.subtitle')}
              </p>
            </div>
            
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button data-testid="add-article-button">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('readingHub.addArticle')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t('readingHub.addArticle')}</DialogTitle>
                </DialogHeader>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="title">{t('readingHub.articleTitle')} *</Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        required
                        data-testid="article-title-input"
                      />
                    </div>
                    <div>
                      <Label htmlFor="url">{t('readingHub.articleUrl')} *</Label>
                      <Input
                        id="url"
                        type="url"
                        value={formData.url}
                        onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                        required
                        data-testid="article-url-input"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="description">{t('readingHub.articleDescription')}</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                    />
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="author">{t('readingHub.articleAuthor')}</Label>
                      <Input
                        id="author"
                        value={formData.author}
                        onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="source">{t('readingHub.articleSource')}</Label>
                      <Input
                        id="source"
                        value={formData.source}
                        onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="category">{t('readingHub.articleCategory')}</Label>
                      <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.slice(1).map((category) => (
                            <SelectItem key={category.value} value={category.value}>
                              {category.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="notes">{t('readingHub.articleNotes')}</Label>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                      placeholder="Your thoughts, key takeaways, or how this relates to your business..."
                    />
                  </div>
                  
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button type="submit" disabled={createArticleMutation.isPending}>
                      {createArticleMutation.isPending ? t('common.loading') : t('readingHub.addArticle')}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {/* Filters and Search */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t('readingHub.searchArticles')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="search-articles-input"
                />
              </div>
              
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Button
                  variant={showUnreadOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                >
                  {t('readingHub.unreadOnly')} ({unreadCount})
                </Button>
                <Button
                  variant={showFavoritesOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                >
                  {t('readingHub.favoritesOnly')} ({favoriteCount})
                </Button>
              </div>
              
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant={view === 'grid' ? "default" : "outline"}
                  size="sm"
                  onClick={() => setView('grid')}
                >
                  {t('readingHub.gridView')}
                </Button>
                <Button
                  variant={view === 'list' ? "default" : "outline"}
                  size="sm"
                  onClick={() => setView('list')}
                >
                  {t('readingHub.listView')}
                </Button>
              </div>
            </div>
          </div>

          {/* Articles */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
              </div>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg text-gray-900 dark:text-white mb-2">
                  {articles.length === 0 ? t('readingHub.noArticles') : t('readingHub.searchArticles')}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {articles.length === 0 
                    ? t('readingHub.noArticlesDescription')
                    : t('readingHub.searchArticles')
                  }
                </p>
              </div>
            </div>
          ) : (
            <div className={view === 'grid' 
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" 
              : "space-y-4"
            }>
              {filteredArticles.map((article: SavedArticle) => (
                <Card 
                  key={article.id} 
                  className={`group hover:shadow-lg transition-shadow ${!article.isRead ? 'border-l-4 border-l-blue-500' : ''}`}
                  data-testid={`article-card-${article.id}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base leading-tight mb-2">
                          {article.title}
                        </CardTitle>
                        {article.description && (
                          <CardDescription className="line-clamp-2">
                            {article.description}
                          </CardDescription>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleFavoriteMutation.mutate({ 
                            id: article.id, 
                            isFavorite: !article.isFavorite 
                          })}
                          className="h-8 w-8 p-0"
                        >
                          <Heart className={`h-4 w-4 ${article.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteArticleMutation.mutate(article.id)}
                          className="h-8 w-8 p-0 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      {(article.author || article.source) && (
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {article.author && <span>by {article.author}</span>}
                          {article.author && article.source && <span> • </span>}
                          {article.source && <span>{article.source}</span>}
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2">
                        {article.category && (
                          <Badge variant="secondary" className="text-xs">
                            {article.category}
                          </Badge>
                        )}
                        {article.readingTime && (
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />
                            {article.readingTime} min
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(article.url, '_blank')}
                            className="h-8"
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            {t('strategy.readMore')}
                          </Button>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleReadMutation.mutate({ 
                              id: article.id, 
                              isRead: !article.isRead 
                            })}
                            className="h-8"
                          >
                            <Eye className={`h-3 w-3 mr-1 ${article.isRead ? 'text-green-500' : ''}`} />
                            {article.isRead ? t('strategy.readMore') : t('readingHub.unreadOnly')}
                          </Button>
                        </div>
                        
                        <div className="text-xs text-gray-500">
                          {article.createdAt ? new Date(article.createdAt).toLocaleDateString() : 'Unknown date'}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}