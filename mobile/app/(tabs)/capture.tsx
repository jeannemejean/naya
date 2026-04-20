import { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import api from "../../lib/api";
import { defaultFetcher } from "../../lib/queryClient";

const CAPTURE_TYPES = [
  { value: "idea", label: "💡 Idée", color: "#f59e0b" },
  { value: "task", label: "✅ Tâche", color: "#10b981" },
  { value: "note", label: "📝 Note", color: "#6366f1" },
  { value: "question", label: "❓ Question", color: "#ec4899" },
  { value: "observation", label: "👁 Observation", color: "#06b6d4" },
];

export default function CaptureScreen() {
  const [text, setText] = useState("");
  const [selectedType, setSelectedType] = useState("idea");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const queryClient = useQueryClient();

  const { data: recent, isLoading } = useQuery<any[]>({
    queryKey: ["/api/capture"],
    queryFn: () => defaultFetcher("/api/capture?processed=false"),
  });

  const captureMutation = useMutation({
    mutationFn: (content: string) =>
      api.post("/api/capture", {
        content,
        captureType: "text",
        classifiedType: selectedType,
        source: "mobile",
      }).then(r => r.data),
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["/api/capture"] });
    },
    onError: () => Alert.alert("Erreur", "Impossible de sauvegarder la capture."),
  });

  const handleCapture = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    captureMutation.mutate(trimmed);
  };

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Micro requis", "Autorise l'accès au micro dans les réglages.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = rec;
      setRecording(rec);
    } catch {
      Alert.alert("Erreur", "Impossible de démarrer l'enregistrement.");
    }
  };

  const stopRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    setRecording(null);
    recordingRef.current = null;
    setIsTranscribing(true);
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (!uri) throw new Error("No URI");

      const formData = new FormData();
      formData.append("audio", { uri, type: "audio/m4a", name: "capture.m4a" } as any);
      const { data } = await api.post("/api/transcribe", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (data.text) setText(prev => (prev ? `${prev} ${data.text}` : data.text));
    } catch {
      Alert.alert("Erreur", "Transcription impossible. Réessaie.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleVoiceBtn = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Capture rapide</Text>
        <Text style={styles.subtitle}>Capte l'instant. Naya classe pour toi.</Text>
      </View>

      {/* Zone de texte */}
      <View style={styles.inputCard}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={
            recording ? "À l'écoute…" : isTranscribing ? "Transcription…" : "Qu'est-ce qui te traverse l'esprit ?"
          }
          placeholderTextColor={recording ? "#ef4444" : "#475569"}
          multiline
          numberOfLines={4}
          maxLength={1000}
          autoFocus={!recording}
          editable={!recording && !isTranscribing}
        />

        {/* Barre actions : micro + type selector */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.voiceBtn, recording && styles.voiceBtnActive]}
            onPress={handleVoiceBtn}
            disabled={isTranscribing}
          >
            {isTranscribing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name={recording ? "stop" : "mic"} size={20} color="#fff" />
            )}
          </TouchableOpacity>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeRow}>
            {CAPTURE_TYPES.map(t => (
              <TouchableOpacity
                key={t.value}
                style={[styles.typeBtn, selectedType === t.value && { borderColor: t.color, backgroundColor: `${t.color}20` }]}
                onPress={() => setSelectedType(t.value)}
              >
                <Text style={[styles.typeBtnText, selectedType === t.value && { color: t.color }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Bouton envoyer */}
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || captureMutation.isPending) && styles.sendBtnDisabled]}
          onPress={handleCapture}
          disabled={!text.trim() || captureMutation.isPending}
        >
          {captureMutation.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="flash" size={18} color="#fff" />
              <Text style={styles.sendBtnText}>Capturer</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Captures récentes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Non traitées</Text>
        {isLoading ? (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 20 }} />
        ) : !recent || recent.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={32} color="#334155" />
            <Text style={styles.emptyText}>Rien à traiter</Text>
          </View>
        ) : (
          recent.slice(0, 10).map((item: any) => {
            const typeCfg = CAPTURE_TYPES.find(t => t.value === item.classifiedType) || CAPTURE_TYPES[2];
            return (
              <View key={item.id} style={styles.captureCard}>
                <View style={[styles.captureTypeDot, { backgroundColor: typeCfg.color }]} />
                <View style={styles.captureBody}>
                  <Text style={styles.captureText} numberOfLines={3}>{item.content}</Text>
                  <Text style={styles.captureDate}>
                    {typeCfg.label} · {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: { padding: 20, paddingTop: 56 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 4 },
  inputCard: { margin: 16, backgroundColor: "#1e1e2e", borderRadius: 20, padding: 16, gap: 12 },
  input: { fontSize: 16, color: "#e2e8f0", minHeight: 100, textAlignVertical: "top", lineHeight: 24 },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  voiceBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#334155",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  voiceBtnActive: { backgroundColor: "#ef4444" },
  typeRow: { flexDirection: "row", flex: 1 },
  typeBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#2d2d44", marginRight: 8, backgroundColor: "#0f0f1a" },
  typeBtnText: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#4f46e5", borderRadius: 14, paddingVertical: 14 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  section: { padding: 20, paddingTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#fff", marginBottom: 12 },
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText: { color: "#334155", fontSize: 14 },
  captureCard: { flexDirection: "row", gap: 12, backgroundColor: "#1e1e2e", borderRadius: 12, padding: 14, marginBottom: 8 },
  captureTypeDot: { width: 4, borderRadius: 2, alignSelf: "stretch", minHeight: 40, flexShrink: 0 },
  captureBody: { flex: 1 },
  captureText: { color: "#e2e8f0", fontSize: 14, lineHeight: 20 },
  captureDate: { color: "#64748b", fontSize: 11, marginTop: 6 },
});
