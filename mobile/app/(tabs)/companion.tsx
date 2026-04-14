import { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, AppState,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import api from "../../lib/api";
import { defaultFetcher } from "../../lib/queryClient";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: any[];
  isLoading?: boolean;
}

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_TIME = new Date().toTimeString().slice(0, 5);

interface CompanionContext {
  energyLevel: string;
  todayTasks: any[];
  upcomingTasks: Array<{ title: string; date: string; time?: string; taskId: number }>;
  activeMilestone: { id: number; title: string; status: string } | null;
  activeProject: { id: number; name: string } | null;
  brandDnaSummary: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  create_task: "✅ Tâche créée",
  create_task_list: "📋 Liste créée",
  create_note: "📝 Note enregistrée",
  create_reminder: "⏰ Rappel créé",
  complete_task: "✅ Tâche complétée",
  reschedule_task: "📅 Tâche replanifiée",
  reschedule_day: "📅 Journée réorganisée",
  set_energy: "⚡ Énergie mise à jour",
  create_milestone_chain: "🗺 Jalons créés",
  confirm_milestone: "✅ Jalon confirmé",
  add_project_note: "📝 Note projet enregistrée",
  reschedule_tasks: "📅 Tâches déplacées",
  show_project_roadmap: "🗺 Roadmap affichée",
  create_project: "🚀 Projet créé",
};

const ENERGY_COLORS: Record<string, string> = {
  high: "#10b981",
  medium: "#f59e0b",
  low: "#f97316",
  depleted: "#6366f1",
};

const ENERGY_LABELS: Record<string, string> = {
  high: "Énergie haute",
  medium: "Énergie moyenne",
  low: "Énergie basse",
  depleted: "Mode repos",
};

function ContextBanner({ ctx }: { ctx: CompanionContext | undefined }) {
  if (!ctx) return null;

  const energyColor = ENERGY_COLORS[ctx.energyLevel] || "#6366f1";
  const energyLabel = ENERGY_LABELS[ctx.energyLevel] || ctx.energyLevel;
  const taskCount = ctx.todayTasks.filter((t: any) => !t.completed).length;

  const parts: string[] = [`⚡ ${energyLabel}`];
  if (ctx.activeMilestone) parts.push(`🏁 ${ctx.activeMilestone.title}`);
  if (taskCount > 0) parts.push(`${taskCount} tâche${taskCount > 1 ? "s" : ""} aujourd'hui`);

  return (
    <View style={bannerStyles.wrap}>
      <Text style={[bannerStyles.text, { color: energyColor }]} numberOfLines={1}>
        {parts.join("  ·  ")}
      </Text>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  wrap: {
    backgroundColor: "#1e1e2e",
    borderLeftWidth: 3,
    borderLeftColor: "#4f46e5",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  text: { fontSize: 12, fontWeight: "500" },
});

export default function CompanionScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const listRef = useRef<FlatList>(null);
  const queryClient = useQueryClient();

  // Charger l'historique
  const { data: history } = useQuery<any[]>({
    queryKey: ["/api/companion/history"],
    queryFn: () => defaultFetcher("/api/companion/history"),
  });

  // Contexte enrichi
  const { data: todayTasks } = useQuery<any[]>({
    queryKey: ["/api/tasks", TODAY],
    queryFn: () => defaultFetcher(`/api/tasks?date=${TODAY}`),
  });

  const { data: projects } = useQuery<any[]>({
    queryKey: ["/api/projects"],
    queryFn: () => defaultFetcher("/api/projects"),
  });

  const { data: companionCtx } = useQuery<CompanionContext>({
    queryKey: ["/api/companion/context"],
    queryFn: () => defaultFetcher("/api/companion/context"),
    staleTime: 60_000,
  });

  const activeProject = projects?.find((p: any) => p.projectStatus === "active") || projects?.[0] || null;

  // Arrêter l'enregistrement si l'app passe en background (évite fuite de ressource audio)
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (nextState) => {
      if (nextState !== "active" && recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch {}
        recordingRef.current = null;
        setRecording(null);
        setIsTranscribing(false);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (history && messages.length === 0) {
      setMessages(history.map((m, i) => ({
        id: String(i),
        role: m.role,
        content: m.content,
        actions: m.actions,
      })));
    }
  }, [history]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      api.post("/api/companion/chat", {
        message,
        context: {
          currentDate: TODAY,
          currentTime: NOW_TIME,
          platform: "mobile",
          todayTasks: (companionCtx?.todayTasks || todayTasks || []).slice(0, 10),
          activeProject: companionCtx?.activeProject || (activeProject
            ? { id: activeProject.id, name: activeProject.name }
            : null),
          energyLevel: companionCtx?.energyLevel,
          upcomingTasks: companionCtx?.upcomingTasks || [],
          activeMilestone: companionCtx?.activeMilestone || null,
          brandDnaSummary: companionCtx?.brandDnaSummary || null,
        },
        conversationHistory: messages
          .filter(m => !m.isLoading)
          .slice(-10)
          .map(m => ({ role: m.role, content: m.content })),
      }).then(r => r.data),

    onSuccess: async (data) => {
      setMessages(prev => {
        const withoutLoading = prev.filter(m => !m.isLoading);
        return [...withoutLoading, {
          id: Date.now().toString(),
          role: "assistant",
          content: data.message,
          actions: data.actions,
        }];
      });

      // Exécuter les actions
      if (data.actions?.length) {
        for (const action of data.actions) {
          await executeAction(action);
        }
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      }
    },

    onError: () => {
      setMessages(prev => {
        const withoutLoading = prev.filter(m => !m.isLoading);
        return [...withoutLoading, {
          id: Date.now().toString(),
          role: "assistant",
          content: "Une erreur est survenue. Réessaie.",
        }];
      });
    },
  });

  const executeAction = async (action: any) => {
    try {
      switch (action.type) {
        case "create_task":
          await api.post("/api/tasks", {
            title: action.title, type: "planning", category: "planning",
            priority: 3, scheduledDate: action.scheduledDate,
            projectId: action.projectId || null, source: "companion",
          });
          break;

        case "create_task_list":
          await api.post("/api/task-lists", { title: action.title, items: action.items });
          break;

        case "create_note":
          await api.post("/api/capture", { content: action.content, captureType: "text" });
          break;

        case "complete_task":
          await api.patch(`/api/tasks/${action.taskId}`, { completed: true });
          break;

        case "set_energy":
          await api.patch("/api/preferences", { currentEnergyLevel: action.level, energyUpdatedDate: TODAY });
          queryClient.invalidateQueries({ queryKey: ["/api/companion/context"] });
          break;

        case "create_milestone_chain":
          await api.post(`/api/projects/${action.projectId}/milestone-chain`, { milestones: action.milestones });
          break;

        case "confirm_milestone":
          await api.post(`/api/milestones/${action.milestoneId}/confirm`);
          queryClient.invalidateQueries({ queryKey: ["/api/companion/context"] });
          break;

        case "add_project_note":
          await api.post(`/api/projects/${action.projectId}/notes`, { content: action.content });
          break;

        case "reschedule_tasks":
          await api.patch("/api/tasks/bulk-reschedule", { fromDate: action.fromDate, toDate: action.toDate });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/companion/context"] });
          break;

        case "show_project_roadmap": {
          const response = await api.get(`/api/projects/${action.projectId}/milestones`);
          const milestones: any[] = response.data || [];
          const statusIcon: Record<string, string> = {
            completed: "✅",
            active: "🔓",
            unlocked: "🔓",
            locked: "🔒",
          };
          const roadmapText = milestones
            .map(m => `${statusIcon[m.status] || "·"} ${m.title}`)
            .join("\n");
          setMessages(prev => [...prev, {
            id: `roadmap-${Date.now()}`,
            role: "assistant" as const,
            content: `Roadmap du projet :\n\n${roadmapText}`,
          }]);
          return;
        }

        case "reschedule_task":
          await api.patch(`/api/tasks/${action.taskId}`, {
            scheduledDate: action.newDate,
            ...(action.newTime ? { scheduledTime: action.newTime } : {}),
          });
          break;

        case "create_reminder":
          await api.post("/api/tasks", {
            title: action.title, type: "reminder", category: "planning",
            priority: 2, scheduledDate: action.datetime?.slice(0, 10) || TODAY,
            scheduledTime: action.datetime?.slice(11, 16) || undefined,
            source: "companion",
          });
          break;

        case "reschedule_day":
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          break;

        case "create_project": {
          const projResponse = await api.post("/api/projects", {
            name: action.name,
            type: action.projectType || "other",
            description: action.description || "",
          });
          if (action.milestones?.length && projResponse.data?.id) {
            await api.post(`/api/projects/${projResponse.data.id}/milestone-chain`, {
              milestones: action.milestones,
            });
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
          }
          break;
        }
      }
    } catch (e) {
      console.warn("Action failed:", action.type, e);
    }
  };

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Micro requis",
          "Naya a besoin d'accéder au micro pour t'écouter. Active-le dans les réglages.",
          [{ text: "OK" }]
        );
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = rec;
      setRecording(rec);
    } catch (e) {
      console.warn("startRecording error:", e);
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      recordingRef.current = null;
      setRecording(null);

      if (!uri) return;

      setIsTranscribing(true);
      const formData = new FormData();
      formData.append("audio", { uri, name: "recording.m4a", type: "audio/m4a" } as any);

      const response = await api.post("/api/transcribe", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 30_000,
      });

      const text = response.data?.text?.trim();
      if (text) setInput(text);
    } catch (e) {
      console.warn("transcription error:", e);
      Alert.alert("Erreur", "La transcription a échoué. Réessaie.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || chatMutation.isPending) return;
    setInput("");
    setMessages(prev => [
      ...prev,
      { id: Date.now().toString(), role: "user", content: msg },
      { id: "loading", role: "assistant", content: "", isLoading: true },
    ]);
    chatMutation.mutate(msg);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.messageWrap, isUser ? styles.messageWrapUser : styles.messageWrapAssistant]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>✦</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          {item.isLoading ? (
            <View style={styles.dotsWrap}>
              <ActivityIndicator size="small" color="#818cf8" />
            </View>
          ) : (
            <>
              <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
                {item.content}
              </Text>
              {item.actions?.length > 0 && (
                <View style={styles.actionsWrap}>
                  {item.actions.map((a: any, i: number) => (
                    <Text key={i} style={styles.actionTag}>
                      {ACTION_LABELS[a.type] || a.type}
                    </Text>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLogo}>✦</Text>
        <View>
          <Text style={styles.headerTitle}>Naya</Text>
          <Text style={styles.headerSub}>Ton partenaire de réflexion</Text>
        </View>
      </View>

      {/* Bandeau contexte */}
      <ContextBanner ctx={companionCtx} />

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyLogo}>✦</Text>
          <Text style={styles.emptyTitle}>Comment puis-je t'aider ?</Text>
          <Text style={styles.emptySub}>Crée des tâches, planifie, réfléchis ensemble.</Text>

          {/* Suggestions rapides */}
          <View style={styles.suggestions}>
            {[
              "Quelles sont mes priorités aujourd'hui ?",
              "Crée-moi une tâche pour demain",
              "J'ai faible énergie aujourd'hui",
            ].map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggestion} onPress={() => {
                setInput(s);
              }}>
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {/* Input */}
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={recording ? "À l'écoute..." : isTranscribing ? "Transcription..." : "Dis-moi ce que tu veux faire..."}
          placeholderTextColor={recording ? "#ef4444" : "#475569"}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!recording && !isTranscribing}
        />
        {/* Bouton micro */}
        <TouchableOpacity
          style={[
            styles.micBtn,
            recording && styles.micBtnRecording,
          ]}
          onPressIn={startRecording}
          onPressOut={stopRecordingAndTranscribe}
          disabled={isTranscribing}
        >
          {isTranscribing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="mic" size={18} color={recording ? "#fff" : "#94a3b8"} />
          )}
        </TouchableOpacity>
        {/* Bouton envoyer */}
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || chatMutation.isPending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || chatMutation.isPending}
        >
          {chatMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 20, paddingTop: 56, borderBottomWidth: 1, borderBottomColor: "#1e1e2e" },
  headerLogo: { fontSize: 28, color: "#818cf8" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  headerSub: { fontSize: 12, color: "#64748b" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyLogo: { fontSize: 48, color: "#4f46e5", marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#fff", marginBottom: 8 },
  emptySub: { fontSize: 14, color: "#64748b", textAlign: "center", marginBottom: 32 },
  suggestions: { gap: 8, width: "100%" },
  suggestion: { backgroundColor: "#1e1e2e", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: "#2d2d44" },
  suggestionText: { color: "#94a3b8", fontSize: 14 },
  messageList: { padding: 16, gap: 12 },
  messageWrap: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  messageWrapUser: { justifyContent: "flex-end" },
  messageWrapAssistant: { justifyContent: "flex-start" },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { fontSize: 12, color: "#fff" },
  bubble: { maxWidth: "78%", borderRadius: 18, padding: 12 },
  bubbleUser: { backgroundColor: "#4f46e5", borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: "#1e1e2e", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: "#fff" },
  bubbleTextAssistant: { color: "#e2e8f0" },
  dotsWrap: { padding: 4 },
  actionsWrap: { marginTop: 8, gap: 4 },
  actionTag: { fontSize: 11, color: "#818cf8" },
  inputWrap: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, paddingBottom: 32, borderTopWidth: 1, borderTopColor: "#1e1e2e" },
  input: { flex: 1, backgroundColor: "#1e1e2e", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: "#fff", maxHeight: 120, borderWidth: 1, borderColor: "#2d2d44" },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.4 },
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#1e1e2e",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2d2d44",
  },
  micBtnRecording: {
    backgroundColor: "#ef4444",
    borderColor: "#ef4444",
  },
});
