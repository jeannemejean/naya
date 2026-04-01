import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ProjectContextValue {
  activeProjectId: number | null;
  setActiveProjectId: (id: number | null) => void;
  isAllProjects: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  activeProjectId: null,
  setActiveProjectId: () => {},
  isAllProjects: true,
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Load from server-side preferences (source of truth)
  const { data: preferences } = useQuery<{ activeProjectId: number | null }>({
    queryKey: ['/api/preferences'],
  });

  const [activeProjectId, setLocalProjectId] = useState<number | null>(() => {
    // Fallback to localStorage while server loads
    const stored = localStorage.getItem('naya_active_project_id');
    return stored ? parseInt(stored) : null;
  });

  // Sync from server once loaded
  useEffect(() => {
    if (preferences !== undefined) {
      const serverId = preferences?.activeProjectId ?? null;
      setLocalProjectId(serverId);
      if (serverId !== null) {
        localStorage.setItem('naya_active_project_id', String(serverId));
      } else {
        localStorage.removeItem('naya_active_project_id');
      }
    }
  }, [preferences]);

  const updatePreference = useMutation({
    mutationFn: (projectId: number | null) =>
      apiRequest('PATCH', '/api/preferences', { activeProjectId: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
    },
  });

  const setActiveProjectId = (id: number | null) => {
    setLocalProjectId(id);
    if (id !== null) {
      localStorage.setItem('naya_active_project_id', String(id));
    } else {
      localStorage.removeItem('naya_active_project_id');
    }
    updatePreference.mutate(id);
  };

  return (
    <ProjectContext.Provider
      value={{
        activeProjectId,
        setActiveProjectId,
        isAllProjects: activeProjectId === null,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
