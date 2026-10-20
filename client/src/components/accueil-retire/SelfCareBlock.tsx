// Un moment pour soi : déplacé tel quel de l'ancien dashboard vers le Planning.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Activity } from "lucide-react";

const SELF_CARE_OPTIONS = [
  { id: "meditation",  labelKey: "selfCareOptions.meditation",  promptKey: "selfCareOptions.meditationPrompt"  },
  { id: "focus-music", labelKey: "selfCareOptions.focusMusic",  promptKey: "selfCareOptions.focusMusicPrompt"  },
  { id: "breathing",   labelKey: "selfCareOptions.breathing",   promptKey: "selfCareOptions.breathingPrompt"   },
  { id: "journal",     labelKey: "selfCareOptions.journal",     promptKey: "selfCareOptions.journalPrompt"     },
];

export default function SelfCareBlock() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem("naya_selfcare") || null);

  const toggleOption = (id: string) => {
    const next = selected === id ? null : id;
    setSelected(next);
    if (next) localStorage.setItem("naya_selfcare", next);
    else localStorage.removeItem("naya_selfcare");
  };

  const activeOption = SELF_CARE_OPTIONS.find(o => o.id === selected);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
          <span className="font-display text-[11px] text-naya-olive-70">
            {t("dashboard.selfCare")}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {SELF_CARE_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => toggleOption(option.id)}
              className={`font-display text-[9px] py-2 px-3 rounded-sm border transition-colors text-left cursor-pointer ${
                selected === option.id
                  ? "border-naya-olive bg-naya-olive text-naya-cream"
                  : "border-naya-olive-18 text-naya-olive-55 hover:border-naya-olive-35 hover:text-naya-olive"
              }`}
            >
              {t(`dashboard.${option.labelKey}`)}
            </button>
          ))}
        </div>
        {activeOption && (
          <p className="text-xs text-naya-olive-70 italic bg-naya-olive-06 p-3 rounded-lg leading-relaxed">
            {t(`dashboard.${activeOption.promptKey}`)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
