import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { router } from "expo-router";
import api from "../lib/api";
import { saveToken, saveUser } from "../lib/auth";
import { queryClient } from "../lib/queryClient";

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Champs requis", "Email et mot de passe sont obligatoires.");
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload: any = { email: email.trim(), password };
      if (mode === "register" && firstName.trim()) payload.firstName = firstName.trim();

      const { data } = await api.post(endpoint, payload);

      if (data.token) {
        await saveToken(data.token);
        const { token: _, hashedPassword: __, ...user } = data;
        await saveUser(user);
        queryClient.invalidateQueries();
        router.replace("/(tabs)");
      } else {
        Alert.alert("Erreur", "Réponse inattendue du serveur.");
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Une erreur est survenue.";
      Alert.alert("Erreur", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <Text style={styles.logoEmoji}>✦</Text>
          <Text style={styles.logoText}>Naya</Text>
          <Text style={styles.tagline}>Ton OS IA personnel</Text>
        </View>

        {/* Toggle login / register */}
        <View style={styles.toggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === "login" && styles.toggleActive]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.toggleText, mode === "login" && styles.toggleActiveText]}>
              Connexion
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === "register" && styles.toggleActive]}
            onPress={() => setMode("register")}
          >
            <Text style={[styles.toggleText, mode === "register" && styles.toggleActiveText]}>
              Inscription
            </Text>
          </TouchableOpacity>
        </View>

        {/* Formulaire */}
        <View style={styles.form}>
          {mode === "register" && (
            <TextInput
              style={styles.input}
              placeholder="Prénom (optionnel)"
              placeholderTextColor="#94a3b8"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#94a3b8"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>
                {mode === "login" ? "Se connecter" : "Créer mon compte"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  logoWrap: { alignItems: "center", marginBottom: 40 },
  logoEmoji: { fontSize: 40, color: "#818cf8", marginBottom: 8 },
  logoText: { fontSize: 36, fontWeight: "700", color: "#fff", letterSpacing: -1 },
  tagline: { fontSize: 14, color: "#64748b", marginTop: 4 },
  toggle: { flexDirection: "row", backgroundColor: "#1e1e2e", borderRadius: 12, padding: 4, marginBottom: 28 },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  toggleActive: { backgroundColor: "#4f46e5" },
  toggleText: { fontSize: 14, color: "#64748b", fontWeight: "500" },
  toggleActiveText: { color: "#fff" },
  form: { gap: 12 },
  input: {
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: "#fff",
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  btn: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
