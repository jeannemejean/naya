import { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { defaultFetcher } from "../../lib/queryClient";
import api from "../../lib/api";

// ─── Utilitaires date ─────────────────────────────────────────────────────────

function toYMD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date) {
  const r = new Date(d);
  const day = r.getDay(); // 0 = dim
  const diff = day === 0 ? -6 : 1 - day; // lundi = début
  r.setDate(r.getDate() + diff);
  return r;
}

const DAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_FR = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];

// ─── Couleurs par type d'énergie ──────────────────────────────────────────────
const ENERGY_COLORS: Record<string, string> = {
  deep_work: "#6366f1",
  creative:  "#ec4899",
  admin:     "#64748b",
  social:    "#10b981",
  execution: "#f59e0b",
  logistics: "#06b6d4",
};

const TASK_TYPE_COLORS: Record<string, string> = {
  linkedin_message: "#0077b5",
  post_publish:     "#6366f1",
  canva_task:       "#8b5cf6",
  email:            "#06b6d4",
  outreach_action:  "#f59e0b",
  generic:          "#475569",
};

export default function CalendarScreen() {
  const queryClient = useQueryClient();
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [selectedDate, setSelectedDate] = useState(toYMD(today));

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const { data: tasks, isLoading } = useQuery<any[]>({
    queryKey: ["/api/tasks"],
    queryFn: () => defaultFetcher("/api/tasks"),
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: number) =>
      api.patch(`/api/tasks/${taskId}`, { completed: true, completedAt: new Date().toISOString() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  // Tâches du jour sélectionné
  const dayTasks = (tasks || [])
    .filter((t: any) => t.scheduledDate === selectedDate)
    .sort((a: any, b: any) => {
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return a.priority - b.priority;
    });

  // Nombre de tâches par jour (pour les points)
  const taskCountByDay: Record<string, number> = {};
  (tasks || []).forEach((t: any) => {
    if (t.scheduledDate) {
      taskCountByDay[t.scheduledDate] = (taskCountByDay[t.scheduledDate] || 0) + 1;
    }
  });

  const prevWeek = () => setWeekStart(d => addDays(d, -7));
  const nextWeek = () => setWeekStart(d => addDays(d, 7));

  const monthLabel = (() => {
    const first = weekDays[0];
    const last = weekDays[6];
    if (first.getMonth() === last.getMonth()) {
      return `${MONTH_FR[first.getMonth()]} ${first.getFullYear()}`;
    }
    return `${MONTH_FR[first.getMonth()]} – ${MONTH_FR[last.getMonth()]} ${last.getFullYear()}`;
  })();

  const todayStr = toYMD(today);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Calendrier</Text>
        <Text style={styles.headerMonth}>{monthLabel}</Text>
      </View>

      {/* Navigation semaine */}
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={prevWeek} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={20} color="#64748b" />
        </TouchableOpacity>

        <View style={styles.weekRow}>
          {weekDays.map((day, i) => {
            const ymd = toYMD(day);
            const isToday = ymd === todayStr;
            const isSelected = ymd === selectedDate;
            const count = taskCountByDay[ymd] || 0;
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.dayBtn,
                  isSelected && styles.dayBtnSelected,
                  isToday && !isSelected && styles.dayBtnToday,
                ]}
                onPress={() => setSelectedDate(ymd)}
              >
                <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>
                  {DAY_SHORT[i]}
                </Text>
                <Text style={[styles.dayNum, isSelected && styles.dayNumSelected, isToday && !isSelected && styles.dayNumToday]}>
                  {day.getDate()}
                </Text>
                {count > 0 && (
                  <View style={[styles.dot, isSelected && styles.dotSelected]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity onPress={nextWeek} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={20} color="#64748b" />
        </TouchableOpacity>
      </View>

      {/* Date sélectionnée */}
      <View style={styles.selectedDateRow}>
        <Text style={styles.selectedDateText}>
          {new Date(selectedDate + "T12:00:00").toLocaleDateString("fr-FR", {
            weekday: "long", day: "numeric", month: "long",
          })}
        </Text>
        <Text style={styles.taskCount}>
          {dayTasks.length} tâche{dayTasks.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Liste de tâches */}
      <ScrollView style={styles.taskList} contentContainerStyle={{ paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 40 }} />
        ) : dayTasks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={40} color="#1e1e2e" />
            <Text style={styles.emptyText}>Rien de prévu ce jour</Text>
            <Text style={styles.emptySubText}>Dis à Naya ce que tu veux planifier</Text>
          </View>
        ) : (
          dayTasks.map((task: any) => (
            <CalendarTaskCard
              key={task.id}
              task={task}
              onComplete={() => {
                if (!task.completed) completeMutation.mutate(task.id);
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Carte de tâche calendrier ────────────────────────────────────────────────

function CalendarTaskCard({ task, onComplete }: { task: any; onComplete: () => void }) {
  const color =
    TASK_TYPE_COLORS[task.taskType] ||
    ENERGY_COLORS[task.taskEnergyType] ||
    "#475569";

  return (
    <View style={[styles.taskCard, task.completed && styles.taskCardDone]}>
      {/* Barre colorée à gauche */}
      <View style={[styles.taskBar, { backgroundColor: color }]} />

      <View style={styles.taskContent}>
        {/* Heure si dispo */}
        {task.scheduledTime && (
          <Text style={styles.taskTime}>{task.scheduledTime}</Text>
        )}
        <Text style={[styles.taskTitle, task.completed && styles.taskTitleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {task.estimatedDuration && (
            <Text style={styles.taskMetaText}>{task.estimatedDuration}min</Text>
          )}
          {task.taskType && task.taskType !== "generic" && (
            <View style={[styles.typePill, { borderColor: color + "55" }]}>
              <Text style={[styles.typePillText, { color }]}>
                {task.taskType === "linkedin_message" ? "LinkedIn" :
                 task.taskType === "post_publish" ? "Post" :
                 task.taskType === "canva_task" ? "Canva" :
                 task.taskType === "email" ? "Email" :
                 task.taskType === "outreach_action" ? "Prospection" : ""}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Bouton compléter */}
      <TouchableOpacity
        style={[styles.checkBtn, task.completed && styles.checkBtnDone]}
        onPress={onComplete}
        disabled={task.completed}
      >
        {task.completed
          ? <Ionicons name="checkmark" size={14} color="#fff" />
          : <View style={styles.checkInner} />
        }
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: "#0f0f1a" },

  header:             { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 },
  headerTitle:        { fontSize: 24, fontWeight: "700", color: "#fff" },
  headerMonth:        { fontSize: 13, color: "#64748b", marginTop: 2, textTransform: "capitalize" },

  weekNav:            { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, marginBottom: 4 },
  navBtn:             { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  weekRow:            { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  dayBtn:             { alignItems: "center", paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12, minWidth: 38 },
  dayBtnSelected:     { backgroundColor: "#4f46e5" },
  dayBtnToday:        { backgroundColor: "#1e1e2e" },
  dayName:            { fontSize: 10, color: "#64748b", fontWeight: "500", textTransform: "uppercase", marginBottom: 4 },
  dayNameSelected:    { color: "#fff" },
  dayNum:             { fontSize: 16, fontWeight: "700", color: "#94a3b8" },
  dayNumSelected:     { color: "#fff" },
  dayNumToday:        { color: "#818cf8" },
  dot:                { width: 4, height: 4, borderRadius: 2, backgroundColor: "#4f46e5", marginTop: 4 },
  dotSelected:        { backgroundColor: "#a5b4fc" },

  selectedDateRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1e1e2e" },
  selectedDateText:   { fontSize: 14, fontWeight: "600", color: "#e2e8f0", textTransform: "capitalize" },
  taskCount:          { fontSize: 12, color: "#64748b" },

  taskList:           { flex: 1, paddingHorizontal: 20, paddingTop: 12 },

  empty:              { alignItems: "center", paddingVertical: 60, gap: 8 },
  emptyText:          { color: "#475569", fontSize: 15, fontWeight: "500" },
  emptySubText:       { color: "#334155", fontSize: 13 },

  taskCard:           { flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e2e", borderRadius: 14, marginBottom: 8, overflow: "hidden" },
  taskCardDone:       { opacity: 0.45 },
  taskBar:            { width: 3, alignSelf: "stretch" },
  taskContent:        { flex: 1, paddingVertical: 12, paddingHorizontal: 12 },
  taskTime:           { fontSize: 11, fontWeight: "700", color: "#64748b", marginBottom: 2, fontVariant: ["tabular-nums"] },
  taskTitle:          { fontSize: 14, color: "#e2e8f0", lineHeight: 20, fontWeight: "500" },
  taskTitleDone:      { textDecorationLine: "line-through", color: "#475569" },
  taskMeta:           { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 },
  taskMetaText:       { fontSize: 11, color: "#64748b" },
  typePill:           { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  typePillText:       { fontSize: 10, fontWeight: "600" },
  checkBtn:           { width: 44, height: "100%", alignItems: "center", justifyContent: "center" },
  checkBtnDone:       { backgroundColor: "#4f46e5" },
  checkInner:         { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#4f46e5" },
});
