import { useState, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import api from "../../lib/api";
import { defaultFetcher } from "../../lib/queryClient";
import { getUser } from "../../lib/auth";

const TODAY = new Date().toISOString().slice(0, 10);

const ENERGY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  high:     { label: "Énergie haute",    color: "#10b981", icon: "flash" },
  medium:   { label: "Énergie moyenne",  color: "#f59e0b", icon: "partly-sunny" },
  low:      { label: "Énergie basse",    color: "#f97316", icon: "cloudy" },
  depleted: { label: "Mode repos",       color: "#6366f1", icon: "moon" },
};

export default function TodayScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any>(null);

  useFocusEffect(useCallback(() => {
    getUser().then(setUser);
  }, []));

  const { data: prefs } = useQuery({
    queryKey: ["/api/preferences"],
    queryFn: () => defaultFetcher("/api/preferences"),
  });

  const { data: brief, isLoading: briefLoading } = useQuery({
    queryKey: ["/api/tasks/daily-brief"],
    queryFn: () => api.post("/api/tasks/daily-brief", { today: TODAY }).then(r => r.data),
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery<any[]>({
    queryKey: ["/api/tasks", TODAY],
    queryFn: () => defaultFetcher(`/api/tasks?date=${TODAY}`),
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: number) =>
      api.patch(`/api/tasks/${taskId}`, { completed: true, completedAt: new Date().toISOString() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  const energyMutation = useMutation({
    mutationFn: (level: string) =>
      api.patch("/api/preferences", { currentEnergyLevel: level, energyUpdatedDate: TODAY }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/preferences"] }),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const todayTasks = (tasks || []).filter((t: any) =>
    t.scheduledDate === TODAY || (!t.scheduledDate && !t.completed)
  );
  const done = todayTasks.filter((t: any) => t.completed).length;
  const total = todayTasks.length;
  const progress = total > 0 ? done / total : 0;

  const energyLevel = prefs?.currentEnergyLevel || "high";
  const energyCfg = ENERGY_CONFIG[energyLevel] || ENERGY_CONFIG.high;

  const greeting = user?.firstName ? `Bonjour, ${user.firstName}` : "Bonjour";

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting} ✦</Text>
          <Text style={styles.date}>
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>
        {/* Sélecteur d'énergie */}
        <TouchableOpacity
          style={[styles.energyBadge, { borderColor: energyCfg.color }]}
          onPress={() => {
            const levels = ["high", "medium", "low", "depleted"];
            const current = levels.indexOf(energyLevel);
            energyMutation.mutate(levels[(current + 1) % levels.length]);
          }}
        >
          <Ionicons name={energyCfg.icon as any} size={14} color={energyCfg.color} />
          <Text style={[styles.energyText, { color: energyCfg.color }]}>{energyCfg.label}</Text>
        </TouchableOpacity>
      </View>

      {/* Brief IA */}
      {briefLoading ? (
        <View style={styles.briefLoading}>
          <ActivityIndicator color="#4f46e5" />
          <Text style={styles.briefLoadingText}>Naya prépare ton brief...</Text>
        </View>
      ) : brief?.content?.greeting ? (
        <View style={styles.brief}>
          <Text style={styles.briefGreeting}>{brief.content.greeting}</Text>
          {brief.content.strategicReminder ? (
            <Text style={styles.briefReminder}>{brief.content.strategicReminder}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Progression */}
      {total > 0 && (
        <View style={styles.progressWrap}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>{done}/{total} tâches</Text>
            <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
      )}

      {/* Liste de tâches */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Aujourd'hui</Text>

        {tasksLoading ? (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 20 }} />
        ) : todayTasks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color="#334155" />
            <Text style={styles.emptyText}>Aucune tâche pour aujourd'hui</Text>
            <Text style={styles.emptySubText}>Dis à Naya ce que tu veux faire</Text>
          </View>
        ) : (
          todayTasks.map((task: any) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={() => {
                if (!task.completed) {
                  Alert.alert("Compléter ?", `"${task.title}"`, [
                    { text: "Annuler", style: "cancel" },
                    { text: "Oui ✅", onPress: () => completeMutation.mutate(task.id) },
                  ]);
                }
              }}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function TaskCard({ task, onComplete }: { task: any; onComplete: () => void }) {
  const ENERGY_COLORS: Record<string, string> = {
    deep_work: "#6366f1",
    creative: "#ec4899",
    admin: "#64748b",
    social: "#10b981",
    execution: "#f59e0b",
    logistics: "#06b6d4",
  };

  return (
    <TouchableOpacity
      style={[styles.taskCard, task.completed && styles.taskCardDone]}
      onPress={onComplete}
      activeOpacity={0.7}
    >
      <View style={[styles.taskCheck, task.completed && styles.taskCheckDone]}>
        {task.completed && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
      <View style={styles.taskBody}>
        <Text style={[styles.taskTitle, task.completed && styles.taskTitleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {task.scheduledTime && (
            <Text style={styles.taskMetaText}>
              <Ionicons name="time-outline" size={11} color="#64748b" /> {task.scheduledTime}
            </Text>
          )}
          {task.estimatedDuration && (
            <Text style={styles.taskMetaText}>{task.estimatedDuration}min</Text>
          )}
          {task.taskEnergyType && (
            <View style={[styles.taskEnergyDot, { backgroundColor: ENERGY_COLORS[task.taskEnergyType] || "#64748b" }]} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 20, paddingTop: 56 },
  greeting: { fontSize: 22, fontWeight: "700", color: "#fff" },
  date: { fontSize: 13, color: "#64748b", marginTop: 2, textTransform: "capitalize" },
  energyBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, backgroundColor: "#1e1e2e" },
  energyText: { fontSize: 11, fontWeight: "600" },
  briefLoading: { alignItems: "center", gap: 8, paddingVertical: 20 },
  briefLoadingText: { color: "#64748b", fontSize: 13 },
  brief: { marginHorizontal: 20, marginBottom: 16, padding: 16, backgroundColor: "#1e1e2e", borderRadius: 16, borderLeftWidth: 3, borderLeftColor: "#4f46e5" },
  briefGreeting: { color: "#e2e8f0", fontSize: 14, lineHeight: 20 },
  briefReminder: { color: "#94a3b8", fontSize: 12, marginTop: 8, lineHeight: 18, fontStyle: "italic" },
  progressWrap: { marginHorizontal: 20, marginBottom: 20 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontSize: 12, color: "#64748b" },
  progressPct: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  progressBar: { height: 4, backgroundColor: "#1e1e2e", borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: "#4f46e5", borderRadius: 2 },
  section: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#fff", marginBottom: 12 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { color: "#475569", fontSize: 15, fontWeight: "500" },
  emptySubText: { color: "#334155", fontSize: 13 },
  taskCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#1e1e2e", borderRadius: 12, padding: 14, marginBottom: 8 },
  taskCardDone: { opacity: 0.5 },
  taskCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#4f46e5", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  taskCheckDone: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  taskBody: { flex: 1 },
  taskTitle: { color: "#e2e8f0", fontSize: 14, lineHeight: 20 },
  taskTitleDone: { textDecorationLine: "line-through", color: "#475569" },
  taskMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  taskMetaText: { fontSize: 11, color: "#64748b" },
  taskEnergyDot: { width: 6, height: 6, borderRadius: 3 },
});
