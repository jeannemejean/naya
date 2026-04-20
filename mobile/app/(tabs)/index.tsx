import { useState, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Clipboard, Linking,
  Modal, TextInput, KeyboardAvoidingView, Platform, SafeAreaView,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

const TASK_TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  linkedin_message: { icon: "chatbubble-outline",    color: "#0077b5", label: "LinkedIn" },
  post_publish:     { icon: "megaphone-outline",     color: "#6366f1", label: "Post" },
  canva_task:       { icon: "color-palette-outline", color: "#8b5cf6", label: "Canva" },
  email:            { icon: "mail-outline",          color: "#06b6d4", label: "Email" },
  call:             { icon: "call-outline",          color: "#10b981", label: "Appel" },
  outreach_action:  { icon: "people-outline",        color: "#f59e0b", label: "Prospection" },
  generic:          { icon: "checkmark-circle-outline", color: "#64748b", label: "" },
};

export default function TodayScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  const [workspaceTask, setWorkspaceTask] = useState<any | null>(null);

  useFocusEffect(useCallback(() => {
    getUser().then(setUser);
  }, []));

  const { data: prefs } = useQuery({
    queryKey: ["/api/preferences"],
    queryFn: () => defaultFetcher("/api/preferences"),
  });

  const { data: brief, isLoading: briefLoading } = useQuery({
    queryKey: ["/api/tasks/daily-brief"],
    queryFn: () => api.post("/api/tasks/daily-brief", { today: TODAY, refresh: true }).then(r => r.data),
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/preferences"] }); queryClient.invalidateQueries({ queryKey: ["/api/tasks/daily-brief"] }); },
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

  // Grouper : actions en attente d'abord, complétées après
  const pending = todayTasks.filter((t: any) => !t.completed);
  const completed = todayTasks.filter((t: any) => t.completed);

  return (
    <>
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

      {/* Tâches en attente */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>À faire</Text>
        {tasksLoading ? (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 20 }} />
        ) : pending.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color="#334155" />
            <Text style={styles.emptyText}>Tout est fait !</Text>
            <Text style={styles.emptySubText}>Dis à Naya ce que tu veux faire</Text>
          </View>
        ) : (
          pending.map((task: any) => (
            <ActionTaskCard
              key={task.id}
              task={task}
              expanded={expandedTask === task.id}
              onToggleExpand={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
              onComplete={() => {
                Alert.alert("Marquer comme fait ?", `"${task.title}"`, [
                  { text: "Annuler", style: "cancel" },
                  { text: "Oui ✅", onPress: () => completeMutation.mutate(task.id) },
                ]);
              }}
              onOpenWorkspace={() => setWorkspaceTask(task)}
            />
          ))
        )}
      </View>

      {/* Tâches complétées */}
      {completed.length > 0 && (
        <View style={[styles.section, { opacity: 0.5 }]}>
          <Text style={styles.sectionTitle}>Complétées</Text>
          {completed.map((task: any) => (
            <View key={task.id} style={[styles.taskCard, styles.taskCardDone]}>
              <View style={[styles.taskCheck, styles.taskCheckDone]}>
                <Ionicons name="checkmark" size={14} color="#fff" />
              </View>
              <Text style={[styles.taskTitle, styles.taskTitleDone]} numberOfLines={1}>
                {task.title}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>

    {/* Workspace modal */}
    {workspaceTask && (
      <TaskWorkspace
        task={workspaceTask}
        onClose={() => setWorkspaceTask(null)}
        onComplete={() => {
          completeMutation.mutate(workspaceTask.id);
          setWorkspaceTask(null);
        }}
      />
    )}
  </>
  );
}

// ─── Workspace d'exécution de tâche ──────────────────────────────────────────

function isContentTask(task: any): boolean {
  const contentKeywords = ["write", "copy", "post", "linkedin", "contenu", "rédige", "publie", "manifesto", "editorial", "identity", "campaign"];
  const title = (task.title || "").toLowerCase();
  const type = task.taskType || "";
  return type === "post_publish" || type === "linkedin_message" ||
    contentKeywords.some(k => title.includes(k));
}

function TaskWorkspace({ task, onClose, onComplete }: { task: any; onClose: () => void; onComplete: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState(task.actionData?.message || task.actionData?.postContent || "");
  const [saved, setSaved] = useState(false);

  const saveContentMutation = useMutation({
    mutationFn: () => api.post("/api/content", {
      title: task.title,
      body: text,
      platform: "linkedin",
      contentType: "post",
      pillar: "brand",
      goal: "awareness",
      projectId: task.projectId || null,
      contentStatus: "draft",
      status: "draft",
    }).then(r => r.data),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/content"] });
      Alert.alert("Sauvegardé ✅", "Le contenu est maintenant visible dans l'onglet Contenu sur le site.");
    },
    onError: () => Alert.alert("Erreur", "Impossible de sauvegarder le contenu."),
  });

  const openWithNaya = async () => {
    const ctx = `Aide-moi à réaliser cette tâche :\n\n**${task.title}**${task.description ? `\n\n${task.description}` : ""}${text ? `\n\nCe que j'ai écrit jusqu'ici :\n${text}` : ""}`;
    await AsyncStorage.setItem("naya_prefill_message", ctx);
    onClose();
    router.push("/(tabs)/companion");
  };

  const isContent = isContentTask(task);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={ws.container}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {/* Header */}
          <View style={ws.header}>
            <TouchableOpacity onPress={onClose} style={ws.closeBtn}>
              <Ionicons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>
            <Text style={ws.headerTitle} numberOfLines={1}>{task.title}</Text>
            <View style={{ width: 36 }} />
          </View>

          <ScrollView style={ws.scroll} keyboardShouldPersistTaps="handled">
            {/* Description */}
            {task.description ? (
              <View style={ws.descBox}>
                <Text style={ws.descLabel}>Brief</Text>
                <Text style={ws.descText}>{task.description}</Text>
              </View>
            ) : null}

            {/* Zone d'exécution */}
            {isContent ? (
              <View style={ws.editorWrap}>
                <View style={ws.editorHeader}>
                  <Ionicons name="logo-linkedin" size={14} color="#0077b5" />
                  <Text style={ws.editorLabel}>Rédaction du post</Text>
                  <Text style={ws.charCount}>{text.length} / 3000</Text>
                </View>
                <TextInput
                  style={ws.editor}
                  value={text}
                  onChangeText={setText}
                  placeholder="Commence à écrire ton post ici…"
                  placeholderTextColor="#334155"
                  multiline
                  maxLength={3000}
                  autoFocus
                />
                <TouchableOpacity
                  style={[ws.saveBtn, (saveContentMutation.isPending || !text.trim()) && ws.saveBtnDisabled]}
                  onPress={() => saveContentMutation.mutate()}
                  disabled={saveContentMutation.isPending || !text.trim()}
                >
                  {saveContentMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name={saved ? "checkmark-circle" : "cloud-upload-outline"} size={16} color="#fff" />
                      <Text style={ws.saveBtnText}>{saved ? "Sauvegardé dans le contenu ✓" : "Enregistrer dans le contenu"}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={ws.editorWrap}>
                <Text style={ws.editorLabel}>Notes d'exécution</Text>
                <TextInput
                  style={ws.editor}
                  value={text}
                  onChangeText={setText}
                  placeholder="Prends des notes, ajoute des réflexions…"
                  placeholderTextColor="#334155"
                  multiline
                  autoFocus
                />
              </View>
            )}

            {/* Actions */}
            <View style={ws.actions}>
              <TouchableOpacity style={ws.nayaBtn} onPress={openWithNaya}>
                <Ionicons name="sparkles-outline" size={16} color="#a78bfa" />
                <Text style={ws.nayaBtnText}>Travailler avec Naya</Text>
              </TouchableOpacity>

              <TouchableOpacity style={ws.completeBtn} onPress={onComplete}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#10b981" />
                <Text style={ws.completeBtnText}>Marquer comme fait</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Carte de tâche actionnable ───────────────────────────────────────────────

function ActionTaskCard({
  task,
  expanded,
  onToggleExpand,
  onComplete,
  onOpenWorkspace,
}: {
  task: any;
  expanded: boolean;
  onToggleExpand: () => void;
  onComplete: () => void;
  onOpenWorkspace: () => void;
}) {
  const router = useRouter();
  const type = task.taskType || "generic";
  const cfg = TASK_TYPE_CONFIG[type] || TASK_TYPE_CONFIG.generic;
  const actionData = task.actionData || {};

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setString(text);
    Alert.alert("Copié !", `${label} copié dans le presse-papier.`);
  };

  // Ouvre le Companion avec le contexte de cette tâche pré-chargé
  const openWithNaya = async () => {
    const context = `Aide-moi à réaliser cette tâche :\n\n**${task.title}**${task.description ? `\n\n${task.description}` : ""}${task.estimatedDuration ? `\n\nDurée estimée : ${task.estimatedDuration} min` : ""}`;
    await AsyncStorage.setItem("naya_prefill_message", context);
    router.push("/(tabs)/companion");
  };

  const isActionable = type === "linkedin_message" || type === "post_publish" || type === "canva_task" || type === "email";

  const handlePrimaryAction = () => {
    switch (type) {
      case "linkedin_message":
        if (actionData.message) copyToClipboard(actionData.message, "Message LinkedIn");
        onComplete();
        break;
      case "post_publish":
        if (actionData.postContent) copyToClipboard(actionData.postContent, "Post");
        onComplete();
        break;
      case "canva_task":
        Linking.openURL(actionData.externalUrl || "https://www.canva.com/design/new");
        break;
      case "email":
        if (actionData.message) copyToClipboard(actionData.message, "Email");
        onComplete();
        break;
    }
  };

  const actionLabel: Record<string, string> = {
    linkedin_message: "Copier & marquer envoyé",
    post_publish:     "Copier le post",
    canva_task:       "Ouvrir Canva",
    email:            "Copier l'email",
  };

  return (
    <View style={styles.actionCard}>
      {/* Header — toujours cliquable pour expand */}
      <TouchableOpacity style={styles.actionCardHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={[styles.typeIcon, { backgroundColor: cfg.color + "22", borderColor: cfg.color + "44" }]}>
          <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
        </View>
        <View style={styles.actionCardBody}>
          <Text style={styles.taskTitle} numberOfLines={expanded ? 0 : 2}>{task.title}</Text>
          <View style={styles.taskMeta}>
            {cfg.label ? <Text style={[styles.typeBadge, { color: cfg.color }]}>{cfg.label}</Text> : null}
            {actionData.platform && <Text style={styles.taskMetaText}>{actionData.platform}</Text>}
            {actionData.leadName && <Text style={styles.taskMetaText}>→ {actionData.leadName}</Text>}
            {task.estimatedDuration && <Text style={styles.taskMetaText}>{task.estimatedDuration}min</Text>}
          </View>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color="#64748b" />
      </TouchableOpacity>

      {/* Contenu expandé */}
      {expanded && (
        <View style={styles.expandedContent}>
          {/* Description toujours affichée si dispo */}
          {(task.description || actionData.message || actionData.postContent || actionData.canvaBrief) ? (
            <View style={styles.contentBox}>
              {type === "email" && actionData.subject ? (
                <Text style={styles.contentLabel}>Objet : {actionData.subject}</Text>
              ) : null}
              <Text style={styles.contentText}>
                {actionData.message || actionData.postContent || actionData.canvaBrief || task.description}
              </Text>
            </View>
          ) : null}

          {/* Bouton action spécifique (copy/open) */}
          {isActionable && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: cfg.color }]} onPress={handlePrimaryAction}>
              <Ionicons name={type === "canva_task" ? "open-outline" : "copy-outline"} size={15} color="#fff" />
              <Text style={styles.actionBtnText}>{actionLabel[type]}</Text>
            </TouchableOpacity>
          )}

          {/* Réaliser la tâche — ouvre le workspace */}
          <TouchableOpacity style={styles.workspaceBtn} onPress={onOpenWorkspace}>
            <Ionicons name="play-circle-outline" size={15} color="#fff" />
            <Text style={styles.workspaceBtnText}>Réaliser la tâche</Text>
          </TouchableOpacity>

          {/* Travailler avec Naya */}
          <TouchableOpacity style={styles.nayaBtn} onPress={openWithNaya}>
            <Ionicons name="sparkles-outline" size={15} color="#a78bfa" />
            <Text style={styles.nayaBtnText}>Travailler avec Naya →</Text>
          </TouchableOpacity>

          {/* Marquer comme fait */}
          <TouchableOpacity style={styles.completeBtn} onPress={onComplete}>
            <Ionicons name="checkmark-circle-outline" size={15} color="#10b981" />
            <Text style={styles.completeBtnText}>Marquer comme fait</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: "#0f0f1a" },
  header:             { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 20, paddingTop: 56 },
  greeting:           { fontSize: 22, fontWeight: "700", color: "#fff" },
  date:               { fontSize: 13, color: "#64748b", marginTop: 2, textTransform: "capitalize" },
  energyBadge:        { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, backgroundColor: "#1e1e2e" },
  energyText:         { fontSize: 11, fontWeight: "600" },
  briefLoading:       { alignItems: "center", gap: 8, paddingVertical: 20 },
  briefLoadingText:   { color: "#64748b", fontSize: 13 },
  brief:              { marginHorizontal: 20, marginBottom: 16, padding: 16, backgroundColor: "#1e1e2e", borderRadius: 16, borderLeftWidth: 3, borderLeftColor: "#4f46e5" },
  briefGreeting:      { color: "#e2e8f0", fontSize: 14, lineHeight: 20 },
  briefReminder:      { color: "#94a3b8", fontSize: 12, marginTop: 8, lineHeight: 18, fontStyle: "italic" },
  progressWrap:       { marginHorizontal: 20, marginBottom: 20 },
  progressHeader:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel:      { fontSize: 12, color: "#64748b" },
  progressPct:        { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  progressBar:        { height: 4, backgroundColor: "#1e1e2e", borderRadius: 2 },
  progressFill:       { height: 4, backgroundColor: "#4f46e5", borderRadius: 2 },
  section:            { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle:       { fontSize: 16, fontWeight: "600", color: "#fff", marginBottom: 12 },
  empty:              { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText:          { color: "#475569", fontSize: 15, fontWeight: "500" },
  emptySubText:       { color: "#334155", fontSize: 13 },

  // Tâches complétées (version simple)
  taskCard:           { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1e1e2e", borderRadius: 12, padding: 14, marginBottom: 6 },
  taskCardDone:       { opacity: 0.6 },
  taskCheck:          { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#4f46e5", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  taskCheckDone:      { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },

  // Carte actionnable
  actionCard:         { backgroundColor: "#1e1e2e", borderRadius: 16, marginBottom: 10, overflow: "hidden" },
  actionCardHeader:   { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  typeIcon:           { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  actionCardBody:     { flex: 1 },
  taskTitle:          { color: "#e2e8f0", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  taskTitleDone:      { textDecorationLine: "line-through", color: "#475569" },
  taskMeta:           { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  taskMetaText:       { fontSize: 11, color: "#64748b" },
  typeBadge:          { fontSize: 11, fontWeight: "600" },

  // Contenu expandé
  expandedContent:    { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  contentBox:         { backgroundColor: "#0f0f1a", borderRadius: 10, padding: 12 },
  contentLabel:       { fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  contentText:        { color: "#94a3b8", fontSize: 13, lineHeight: 20 },
  actionBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12 },
  actionBtnText:      { color: "#fff", fontSize: 14, fontWeight: "600" },
  workspaceBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, backgroundColor: "#4f46e5" },
  workspaceBtnText:   { color: "#fff", fontSize: 14, fontWeight: "600" },
  nayaBtn:            { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 10, backgroundColor: "#4f46e515", borderWidth: 1, borderColor: "#a78bfa33" },
  nayaBtnText:        { color: "#a78bfa", fontSize: 13, fontWeight: "500" },
  completeBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  completeBtnText:    { color: "#475569", fontSize: 13, fontWeight: "500" },
});

// ─── Styles du workspace ──────────────────────────────────────────────────────

const ws = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#0f0f1a" },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1e1e2e" },
  closeBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:    { flex: 1, fontSize: 15, fontWeight: "600", color: "#e2e8f0", textAlign: "center", paddingHorizontal: 8 },
  scroll:         { flex: 1, padding: 16 },
  descBox:        { backgroundColor: "#1e1e2e", borderRadius: 14, padding: 14, marginBottom: 16 },
  descLabel:      { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  descText:       { color: "#94a3b8", fontSize: 13, lineHeight: 20 },
  editorWrap:     { backgroundColor: "#1e1e2e", borderRadius: 14, padding: 14, marginBottom: 16 },
  editorHeader:   { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  editorLabel:    { flex: 1, fontSize: 12, fontWeight: "600", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 },
  charCount:      { fontSize: 11, color: "#475569" },
  editor:         { color: "#e2e8f0", fontSize: 15, lineHeight: 24, minHeight: 200, textAlignVertical: "top" },
  saveBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  saveBtnDisabled:{ opacity: 0.4 },
  saveBtnText:    { color: "#fff", fontSize: 14, fontWeight: "600" },
  actions:        { gap: 10, paddingBottom: 40 },
  nayaBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, backgroundColor: "#4f46e520", borderWidth: 1, borderColor: "#a78bfa44" },
  nayaBtnText:    { color: "#a78bfa", fontSize: 14, fontWeight: "600" },
  completeBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  completeBtnText:{ color: "#10b981", fontSize: 14, fontWeight: "500" },
});
