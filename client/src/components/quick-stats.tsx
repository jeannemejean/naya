import { useTranslation } from "react-i18next";

export default function QuickStats() {
 const { t } = useTranslation();

 const stats = [
 { label: "IG Reach", value: "2.1k", change: "+12%", isPositive: true },
 { label: "Email Open Rate", value: "48%", change: "+8%", isPositive: true },
 { label: "Response Rate", value: "28%", change: "-5%", isPositive: false },
 { label: "Leads This Week", value: "7", change: "+2", isPositive: true },
 ];

 return (
 <div className="bg-white rounded-lg shadow-sm border border-naya-olive-18">
 <div className="p-6 border-b border-naya-olive-18">
 <h2 className="text-lg text-foreground">{t('quickStats.title')}</h2>
 </div>
 
 <div className="p-6 space-y-4">
 {stats.map((stat, index) => (
 <div key={index} className="flex items-center justify-between p-3 bg-naya-olive-06 rounded-lg">
 <div>
 <p className="text-sm text-naya-olive-55">{stat.label}</p>
 <p className="text-lg text-foreground">{stat.value}</p>
 </div>
 <div className="text-right">
 <span 
 className={`text-xs px-2 py-1 rounded-full ${
 stat.isPositive 
 ? 'text-secondary bg-secondary/10' 
 : 'text-[#5c3d45] bg-[rgba(158,126,135,0.12)]'
 }`}
 >
 {stat.change}
 </span>
 </div>
 </div>
 ))}
 </div>
 </div>
 );
}
