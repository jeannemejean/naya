import { useQuery } from "@tanstack/react-query";
import { Lightbulb, TrendingUp, Users, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function AISuggestions() {
  const { t } = useTranslation();
  const { data: brandDna } = useQuery({
    queryKey: ["/api/brand-dna"],
    retry: false,
  });

  const getPersonalizedSuggestions = () => {
    if (!brandDna) return [];

    const suggestions = [];
    const revenueUrgency = brandDna.revenueUrgency?.toLowerCase() || "";
    const businessType = brandDna.businessType?.toLowerCase() || "";
    const platformPriority = brandDna.platformPriority?.toLowerCase() || "";
    const primaryGoal = brandDna.primaryGoal || "";

    if (revenueUrgency.includes("immediate") || revenueUrgency.includes("urgent")) {
      suggestions.push({
        icon: Zap,
        title: t('aiSuggestions.quickRevenueActions'),
        description: t('aiSuggestions.quickRevenueDescription'),
        color: "text-red-600 bg-red-50"
      });
    }

    if (platformPriority.includes("linkedin")) {
      suggestions.push({
        icon: Users,
        title: t('aiSuggestions.linkedinStrategy'),
        description: t('aiSuggestions.linkedinDescription'),
        color: "text-blue-600 bg-blue-50"
      });
    } else if (platformPriority.includes("twitter") || platformPriority.includes("x")) {
      suggestions.push({
        icon: TrendingUp,
        title: t('aiSuggestions.twitterMomentum'),
        description: t('aiSuggestions.twitterDescription'),
        color: "text-sky-600 bg-sky-50"
      });
    }

    if (businessType.includes("coach") || businessType.includes("consultant")) {
      suggestions.push({
        icon: Lightbulb,
        title: t('aiSuggestions.authorityBuilding'),
        description: t('aiSuggestions.authorityDescription'),
        color: "text-amber-600 bg-amber-50"
      });
    }

    if (suggestions.length < 3) {
      suggestions.push({
        icon: TrendingUp,
        title: t('aiSuggestions.strategicGrowth'),
        description: t('aiSuggestions.strategicGrowthDescription', { goal: primaryGoal }),
        color: "text-primary bg-primary/10"
      });
    }

    return suggestions.slice(0, 3);
  };

  const suggestions = getPersonalizedSuggestions();

  if (suggestions.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg text-slate-900 mb-4 flex items-center">
          <Lightbulb className="w-5 h-5 mr-2 text-amber-500" />
          {t('aiSuggestions.title')}
        </h3>
        <p className="text-slate-600">{t('aiSuggestions.noSuggestions')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h3 className="text-lg text-slate-900 mb-4 flex items-center">
        <Lightbulb className="w-5 h-5 mr-2 text-amber-500" />
        {t('aiSuggestions.title')}
      </h3>
      <div className="space-y-3">
        {suggestions.map((suggestion, index) => {
          const IconComponent = suggestion.icon;
          return (
            <div
              key={index}
              className="flex items-start space-x-3 p-3 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors"
            >
              <div className={`p-2 rounded-lg ${suggestion.color}`}>
                <IconComponent className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-slate-900 text-sm">{suggestion.title}</h4>
                <p className="text-slate-600 text-sm mt-1">{suggestion.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
