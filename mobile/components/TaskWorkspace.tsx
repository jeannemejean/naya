import { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, SafeAreaView,
  ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import api from "../lib/api";

export function isContentTask(task: any): boolean {
  const contentKeywords = ["write", "copy", "post", "linkedin", "contenu", "rédige", "publie", "manifesto", "editorial", "identity", "campaign", "founding"];
  const title = (task.title || "").toLowerCase();
  const type = task.taskType || "";
  return type === "post_publish" || type === "linkedin_message" ||
    contentKeywords.some(k => title.includes(k));
}

export function TaskWorkspace({
  task,
  onClose,
  onComplete,
}: {
  task: any;
  onClose: () => void;
  onComplete: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState(task.actionData?.message || task.actionData?.postContent || "");
  const [saved, setSaved] = useState(false);
  const isContent = isContentTask(task);

  const saveContentMutation = useMutation({
    mutationFn: () =>
      api.post("/api/content", {
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
      Alert.alert("Sauvegardé ✅", "Le contenu est visible dans l'onglet Contenu sur le site.");
    },
    onError: () => Alert.alert("Erreur", "Impossible de sauvegarder le contenu."),
  });

  const openWithNaya = async () => {
    const ctx = `Aide-moi à réaliser cette tâche :\n\n**${task.title}**${task.description ? `\n\n${task.description}` : ""}${text ? `\n\nCe que j'ai écrit jusqu'ici :\n${text}` : ""}`;
    await AsyncStorage.setItem("naya_prefill_message", ctx);
    onClose();
    router.push("/(tabs)/companion");
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.container}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>
            <Text style={s.headerTitle} numberOfLines={1}>{task.title}</Text>
            <View style={{ width: 36 }} />
          </View>

          <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
            {/* Description / brief */}
            {task.description ? (
              <View style={s.descBox}>
                <Text style={s.descLabel}>Brief</Text>
                <Text style={s.descText}>{task.description}</Text>
              </View>
            ) : null}

            {/* Zone d'exécution */}
            {isContent ? (
              <View style={s.editorWrap}>
                <View style={s.editorHeader}>
                  <Ionicons name="logo-linkedin" size={14} color="#0077b5" />
                  <Text style={s.editorLabel}>Rédaction du post</Text>
                  <Text style={s.charCount}>{text.length} / 3000</Text>
                </View>
                <TextInput
                  style={s.editor}
                  value={text}
                  onChangeText={setText}
                  placeholder="Commence à écrire ton post ici…"
                  placeholderTextColor="#334155"
                  multiline
                  maxLength={3000}
                  autoFocus
                />
                <TouchableOpacity
                  style={[s.saveBtn, (saveContentMutation.isPending || !text.trim()) && s.saveBtnDisabled]}
                  onPress={() => saveContentMutation.mutate()}
                  disabled={saveContentMutation.isPending || !text.trim()}
                >
                  {saveContentMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name={saved ? "checkmark-circle" : "cloud-upload-outline"} size={16} color="#fff" />
                      <Text style={s.saveBtnText}>{saved ? "Sauvegardé ✓" : "Enregistrer dans le contenu"}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.editorWrap}>
                <Text style={s.editorLabel}>Notes d'exécution</Text>
                <TextInput
                  style={s.editor}
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
            <View style={s.actions}>
              <TouchableOpacity style={s.nayaBtn} onPress={openWithNaya}>
                <Ionicons name="sparkles-outline" size={16} color="#a78bfa" />
                <Text style={s.nayaBtnText}>Travailler avec Naya</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.completeBtn} onPress={onComplete}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#10b981" />
                <Text style={s.completeBtnText}>Marquer comme fait</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: "#0f0f1a" },
  header:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1e1e2e" },
  closeBtn:        { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:     { flex: 1, fontSize: 15, fontWeight: "600", color: "#e2e8f0", textAlign: "center", paddingHorizontal: 8 },
  scroll:          { flex: 1, padding: 16 },
  descBox:         { backgroundColor: "#1e1e2e", borderRadius: 14, padding: 14, marginBottom: 16 },
  descLabel:       { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  descText:        { color: "#94a3b8", fontSize: 13, lineHeight: 20 },
  editorWrap:      { backgroundColor: "#1e1e2e", borderRadius: 14, padding: 14, marginBottom: 16 },
  editorHeader:    { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  editorLabel:     { flex: 1, fontSize: 12, fontWeight: "600", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 },
  charCount:       { fontSize: 11, color: "#475569" },
  editor:          { color: "#e2e8f0", fontSize: 15, lineHeight: 24, minHeight: 200, textAlignVertical: "top" },
  saveBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText:     { color: "#fff", fontSize: 14, fontWeight: "600" },
  actions:         { gap: 10, paddingBottom: 40 },
  nayaBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, backgroundColor: "#4f46e520", borderWidth: 1, borderColor: "#a78bfa44" },
  nayaBtnText:     { color: "#a78bfa", fontSize: 14, fontWeight: "600" },
  completeBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  completeBtnText: { color: "#10b981", fontSize: 14, fontWeight: "500" },
});
