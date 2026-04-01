import { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import api from "../../lib/api";
import { defaultFetcher } from "../../lib/queryClient";

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  locked:    { icon: "lock-closed",      label: "Bloqué",   color: "#475569" },
  unlocked:  { icon: "lock-open",        label: "Débloqué", color: "#3b82f6" },
  active:    { icon: "flash",            label: "Actif",    color: "#6366f1" },
  completed: { icon: "checkmark-circle", label: "Complété", color: "#10b981" },
  skipped:   { icon: "remove-circle",    label: "Ignoré",   color: "#334155" },
};

export default function ProjectsScreen() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useQuery<any[]>({
    queryKey: ["/api/projects"],
    queryFn: () => defaultFetcher("/api/projects"),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4f46e5" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Projets</Text>
        <Text style={styles.subtitle}>
          {projects?.length || 0} projet{(projects?.length || 0) > 1 ? "s" : ""}
        </Text>
      </View>

      {!projects || projects.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={48} color="#334155" />
          <Text style={styles.emptyTitle}>Aucun projet</Text>
          <Text style={styles.emptySub}>Crée ton premier projet depuis le web</Text>
        </View>
      ) : (
        projects.map((project: any) => (
          <View key={project.id}>
            <TouchableOpacity
              style={[styles.projectCard, selectedProjectId === project.id && styles.projectCardActive]}
              onPress={() => setSelectedProjectId(selectedProjectId === project.id ? null : project.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.projectIcon, { backgroundColor: project.color || "#4f46e5" }]}>
                <Text style={styles.projectIconText}>{project.icon || "📁"}</Text>
              </View>
              <View style={styles.projectInfo}>
                <Text style={styles.projectName}>{project.name}</Text>
                <Text style={styles.projectType}>{project.type}</Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: project.projectStatus === "active" ? "#10b981" : "#475569" }]} />
              <Ionicons
                name={selectedProjectId === project.id ? "chevron-up" : "chevron-down"}
                size={16}
                color="#64748b"
              />
            </TouchableOpacity>

            {/* Roadmap jalons */}
            {selectedProjectId === project.id && (
              <MilestoneRoadmap projectId={project.id} />
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function MilestoneRoadmap({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();

  const { data: milestones, isLoading } = useQuery<any[]>({
    queryKey: [`/api/projects/${projectId}/milestones`],
    queryFn: () => defaultFetcher(`/api/projects/${projectId}/milestones`),
  });

  const confirmMutation = useMutation({
    mutationFn: (milestoneId: number) =>
      api.post(`/api/milestones/${milestoneId}/confirm`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/milestones`] }),
  });

  if (isLoading) {
    return <ActivityIndicator color="#4f46e5" style={{ margin: 16 }} />;
  }

  if (!milestones || milestones.length === 0) {
    return (
      <View style={styles.roadmapEmpty}>
        <Ionicons name="flag-outline" size={24} color="#334155" />
        <Text style={styles.roadmapEmptyText}>Aucun jalon · Dis à Naya de créer une chaîne</Text>
      </View>
    );
  }

  return (
    <View style={styles.roadmap}>
      {milestones.map((m: any, idx: number) => {
        const cfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.locked;
        const isLocked = m.status === "locked";
        const canConfirm = ["unlocked", "active"].includes(m.status) &&
          m.conditions?.some((c: any) => c.conditionType === "manual_confirm" && !c.isFulfilled);

        return (
          <View key={m.id} style={styles.milestoneRow}>
            {/* Connecteur */}
            <View style={styles.milestoneConnector}>
              <View style={[styles.milestoneDot, { backgroundColor: isLocked ? "#2d2d44" : cfg.color + "40" }]}>
                <Ionicons name={cfg.icon as any} size={12} color={isLocked ? "#475569" : cfg.color} />
              </View>
              {idx < milestones.length - 1 && (
                <View style={[styles.milestoneLine, { backgroundColor: isLocked ? "#1e1e2e" : "#4f46e540" }]} />
              )}
            </View>

            {/* Contenu */}
            <View style={[styles.milestoneContent, isLocked && styles.milestoneContentLocked]}>
              <View style={styles.milestoneTitleRow}>
                <Text style={[styles.milestoneTitle, isLocked && styles.milestoneTitleLocked]} numberOfLines={1}>
                  {m.title}
                </Text>
                <Text style={[styles.milestoneStatus, { color: cfg.color }]}>{cfg.label}</Text>
              </View>

              {m.conditions?.length > 0 && (
                <View style={styles.conditionsRow}>
                  {m.conditions.map((c: any) => (
                    <View key={c.id} style={[styles.conditionTag, c.isFulfilled && styles.conditionTagDone]}>
                      <Ionicons
                        name={c.isFulfilled ? "checkmark" : "lock-closed"}
                        size={9}
                        color={c.isFulfilled ? "#10b981" : "#64748b"}
                      />
                      <Text style={[styles.conditionText, c.isFulfilled && styles.conditionTextDone]} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {canConfirm && (
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => Alert.alert("Confirmer ce jalon ?", m.title, [
                    { text: "Annuler", style: "cancel" },
                    { text: "Confirmer ✅", onPress: () => confirmMutation.mutate(m.id) },
                  ])}
                >
                  <Text style={styles.confirmBtnText}>Confirmer</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f0f1a" },
  header: { padding: 20, paddingTop: 56 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 4 },
  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#475569" },
  emptySub: { fontSize: 13, color: "#334155" },
  projectCard: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 2, backgroundColor: "#1e1e2e", borderRadius: 14, padding: 14 },
  projectCardActive: { borderColor: "#4f46e5", borderWidth: 1 },
  projectIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  projectIconText: { fontSize: 18 },
  projectInfo: { flex: 1 },
  projectName: { fontSize: 15, fontWeight: "600", color: "#fff" },
  projectType: { fontSize: 12, color: "#64748b", marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  roadmapEmpty: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, padding: 14, backgroundColor: "#1e1e2e40", borderRadius: 12 },
  roadmapEmptyText: { fontSize: 13, color: "#475569", flex: 1 },
  roadmap: { marginHorizontal: 16, marginBottom: 8, padding: 16, backgroundColor: "#1e1e2e", borderRadius: 14 },
  milestoneRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  milestoneConnector: { alignItems: "center", width: 24 },
  milestoneDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  milestoneLine: { width: 2, flex: 1, minHeight: 16, marginVertical: 2 },
  milestoneContent: { flex: 1, paddingBottom: 12 },
  milestoneContentLocked: { opacity: 0.55 },
  milestoneTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  milestoneTitle: { fontSize: 14, fontWeight: "500", color: "#e2e8f0", flex: 1 },
  milestoneTitleLocked: { color: "#475569" },
  milestoneStatus: { fontSize: 11, fontWeight: "600" },
  conditionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  conditionTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#2d2d44", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  conditionTagDone: { backgroundColor: "#10b98120" },
  conditionText: { fontSize: 10, color: "#64748b", maxWidth: 160 },
  conditionTextDone: { color: "#10b981" },
  confirmBtn: { alignSelf: "flex-start", backgroundColor: "#4f46e520", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: "#4f46e5", marginTop: 8 },
  confirmBtnText: { fontSize: 12, color: "#818cf8", fontWeight: "600" },
});
