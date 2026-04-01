import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatLocalDate } from "@/lib/dateUtils";

let globalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let globalInFlight = false;
let globalPendingWhileInFlight = false;

async function executeRebalance(
  queryClient: ReturnType<typeof useQueryClient>,
  toastFn: ReturnType<typeof useToast>["toast"],
) {
  globalInFlight = true;
  globalPendingWhileInFlight = false;

  try {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(monday.getDate() + diff);
    const weekStart = formatLocalDate(monday);
    const clientToday = formatLocalDate(now);
    const clientTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const res = await apiRequest("POST", "/api/tasks/rebalance-week", {
      weekStart,
      clientToday,
      clientTime,
    });
    const data = await res.json();

    queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });

    if (data?.moved > 0) {
      toastFn({ title: "Schedule updated" });
    }
  } catch {
  } finally {
    globalInFlight = false;

    if (globalPendingWhileInFlight) {
      globalPendingWhileInFlight = false;
      executeRebalance(queryClient, toastFn);
    }
  }
}

export function useAutoRebalance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const triggerAutoRebalance = useCallback(() => {
    if (globalDebounceTimer) clearTimeout(globalDebounceTimer);

    globalDebounceTimer = setTimeout(() => {
      if (globalInFlight) {
        globalPendingWhileInFlight = true;
        return;
      }
      executeRebalance(queryClientRef.current, toastRef.current);
    }, 800);
  }, []);

  return { triggerAutoRebalance };
}
