import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function QuickActions() {
  const { t } = useTranslation();

  const handleGenerateContent = () => {
    console.log('Opening content generator');
  };

  const handleViewLeads = () => {
    window.location.href = '/outreach';
  };

  const handleWeeklyReview = () => {
    window.location.href = '/strategy';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <h2 className="text-lg text-slate-900">{t('quickActions.title')}</h2>
      </div>
      
      <div className="p-6 space-y-3">
        <Button 
          className="w-full flex items-center justify-center space-x-2 bg-primary text-white hover:bg-primary/90"
          onClick={handleGenerateContent}
        >
          <Plus className="w-4 h-4" />
          <span className="font-medium">{t('quickActions.generateContent')}</span>
        </Button>

        <Button 
          className="w-full flex items-center justify-center space-x-2 bg-secondary text-white hover:bg-secondary/90"
          onClick={handleViewLeads}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="font-medium">{t('quickActions.checkLeads')}</span>
        </Button>

        <Button 
          variant="outline"
          className="w-full flex items-center justify-center space-x-2 border-slate-300 text-slate-700 hover:bg-slate-50"
          onClick={handleWeeklyReview}
        >
          <BarChart3 className="w-4 h-4" />
          <span className="font-medium">{t('quickActions.weeklyReview')}</span>
        </Button>
      </div>
    </div>
  );
}
