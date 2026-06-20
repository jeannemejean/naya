import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

type AuthUser = User & {
  access?: { allowed: boolean; status: string | null; trialEndsAt: string | null; cancelAtPeriodEnd: boolean };
  ai?: { blocked: boolean };
};

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  async function logout() {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (_) {
      // ignorer les erreurs réseau — on déconnecte quand même côté client
    }
    queryClient.clear();
    window.location.href = "/";
  }

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    hasAccess: !!user?.access?.allowed,
    aiBlocked: !!user?.ai?.blocked,
    logout,
  };
}
