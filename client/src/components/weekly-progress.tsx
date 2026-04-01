import { Progress } from "@/components/ui/progress";
import { useTranslation } from "react-i18next";

export default function WeeklyProgress() {
  const { t } = useTranslation();

  const progressData = [
    { label: "Instagram Posts", current: 2, target: 4, percentage: 50 },
    { label: "Leads Contacted", current: 7, target: 5, percentage: 100, isCompleted: true },
    { label: "Emails Sent", current: 2, target: 2, percentage: 100, isCompleted: true },
    { label: "Content Calendar", current: 3, target: 5, percentage: 60 },
  ];

  const currentWeek = new Date().toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric'
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <h2 className="text-lg text-slate-900">{t('weeklyProgress.title')}</h2>
        <p className="text-sm text-slate-500">{currentWeek} - {t('weeklyProgress.thisWeek')}</p>
      </div>
      
      <div className="p-6 space-y-4">
        {progressData.map((item, index) => (
          <div key={index} className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">{item.label}</span>
              <span className={`text-sm ${item.isCompleted ? 'text-secondary' : 'text-slate-600'}`}>
                {item.current}/{item.target} {item.isCompleted && '✓'}
              </span>
            </div>
            <Progress 
              value={item.percentage} 
              className={`h-2 ${item.isCompleted ? '[&>div]:bg-secondary' : '[&>div]:bg-primary'}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
