import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface StuckTask {
 id: number;
 title: string;
 learnedAdjustmentCount: number;
 scheduledDate: string | null;
}

const DISMISSED_KEY = 'naya_stuck_dismissed_at';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

interface StuckTasksCardProps {
 onOpenCompanion?: () => void;
}

export function StuckTasksCard({ onOpenCompanion }: StuckTasksCardProps) {
 const queryClient = useQueryClient();
 const [dismissed, setDismissed] = useState(false);

 useEffect(() => {
 const dismissedAt = localStorage.getItem(DISMISSED_KEY);
 if (dismissedAt) {
 const elapsed = Date.now() - parseInt(dismissedAt, 10);
 if (elapsed < DISMISS_DURATION_MS) setDismissed(true);
 }
 }, []);

 const { data: stuckTasks = [] } = useQuery<StuckTask[]>({
 queryKey: ['/api/tasks/stuck'],
 queryFn: async () => {
 const r = await apiRequest('GET', '/api/tasks/stuck');
 return r.json();
 },
 refetchInterval: 5 * 60 * 1000,
 });

 const handleOpenCompanion = async () => {
 try {
 await apiRequest('POST', '/api/companion/pending-insight', {
 tasks: stuckTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, count: t.learnedAdjustmentCount })),
 });
 queryClient.invalidateQueries({ queryKey: ['/api/companion/pending'] });
 } catch {
 // Non-blocking
 }

 localStorage.setItem(DISMISSED_KEY, Date.now().toString());
 setDismissed(true);
 onOpenCompanion?.();
 };

 if (dismissed || stuckTasks.length < 2) return null;

 const displayed = stuckTasks.slice(0, 5);

 return (
 <Card className="border-[rgba(212,201,122,0.35)] bg-[rgba(212,201,122,0.12)]/50 ">
 <CardContent className="p-4">
 <div className="flex items-start gap-3">
 <Sparkles className="h-4 w-4 text-naya-sulphur mt-0.5 shrink-0" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground mb-2">
 Naya a remarqué
 </p>
 <p className="text-xs text-muted-foreground mb-2">
 {stuckTasks.length} tâche{stuckTasks.length > 1 ? 's' : ''} reviennent depuis plusieurs jours :
 </p>
 <ul className="space-y-0.5 mb-3">
 {displayed.map(task => (
 <li key={task.id} className="text-xs text-muted-foreground flex items-center gap-1.5">
 <span className="w-1 h-1 rounded-full bg-naya-sulphur shrink-0" />
 <span className="truncate">{task.title}</span>
 <span className="text-naya-sulphur shrink-0">({task.learnedAdjustmentCount}x)</span>
 </li>
 ))}
 </ul>
 <Button
 variant="outline"
 size="sm"
 className="h-7 text-xs border-[rgba(212,201,122,0.45)] hover:bg-[rgba(212,201,122,0.20)]"
 onClick={handleOpenCompanion}
 >
 En parler avec Naya →
 </Button>
 </div>
 </div>
 </CardContent>
 </Card>
 );
}
