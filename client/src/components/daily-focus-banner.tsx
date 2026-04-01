import { useQuery } from "@tanstack/react-query";
import { Star, Target, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function DailyFocusBanner() {
  const { t } = useTranslation();
  const { data: brandDna } = useQuery({
    queryKey: ["/api/brand-dna"],
    retry: false,
  });

  const getDayOfWeek = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date().getDay()];
  };

  const getStrategicFocus = () => {
    if (!brandDna) return t('dailyFocus.strategicBusinessGrowth');
    
    const revenueUrgency = brandDna.revenueUrgency?.toLowerCase() || "";
    const businessType = brandDna.businessType?.toLowerCase() || "";
    const day = getDayOfWeek();
    
    if (revenueUrgency.includes("immediate") || revenueUrgency.includes("urgent")) {
      return t('dailyFocus.revenueGeneration');
    } else if (day === "Monday") {
      return t('dailyFocus.weekPlanning');
    } else if (day === "Friday") {
      return t('dailyFocus.relationshipBuilding');
    } else if (businessType.includes("coach") || businessType.includes("consultant")) {
      return t('dailyFocus.authorityBuilding');
    } else {
      return t('dailyFocus.visibilityEngagement');
    }
  };

  const getFocusDescription = () => {
    if (!brandDna) return t('dailyFocus.defaultDescription');
    
    const primaryGoal = brandDna.primaryGoal || "";
    const platformPriority = brandDna.platformPriority || "";
    
    if (primaryGoal.toLowerCase().includes("revenue")) {
      return `Convert your expertise into revenue through ${platformPriority.toLowerCase()} engagement`;
    } else if (primaryGoal.toLowerCase().includes("client")) {
      return `Attract and connect with ideal clients using your unique positioning`;
    } else {
      return `Build momentum toward your 90-day goal through strategic daily actions`;
    }
  };

  return (
    <div className="bg-gradient-to-r from-primary to-primary/80 rounded-xl p-6 text-white">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg mb-2 flex items-center">
            <Target className="w-5 h-5 mr-2" />
            {t('dailyFocus.todaysStrategicFocus')}
          </h2>
          <p className="text-primary-100 mb-3 text-base">
            {getStrategicFocus()}
          </p>
          <p className="text-primary-200 text-sm mb-3">
            {getFocusDescription()}
          </p>
          <div className="flex items-center space-x-3 text-sm">
            <span className="bg-white/20 px-3 py-1 rounded-full flex items-center">
              <TrendingUp className="w-3 h-3 mr-1" />
              {t('dailyFocus.dayFocus', { day: getDayOfWeek() })}
            </span>
            {brandDna?.revenueUrgency?.includes("immediate") && (
              <span className="bg-red-500/30 px-3 py-1 rounded-full">{t('dailyFocus.highPriority')}</span>
            )}
          </div>
        </div>
        <div className="hidden sm:block">
          <Star className="w-16 h-16 text-white/30 fill-current" />
        </div>
      </div>
    </div>
  );
}
