import { useState, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Switch,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import api from "../../lib/api";
import { clearToken, getUser } from "../../lib/auth";
import { queryClient } from "../../lib/queryClient";

// Configurer le handler de notification
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function ProfileScreen() {
  const [user, setUser] = useState<any>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useFocusEffect(useCallback(() => {
    getUser().then(setUser);
  }, []));

  const registerPushNotifications = async () => {
    setRegistering(true);
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        Alert.alert("Notifications refusées", "Autorise les notifications dans les réglages iOS pour recevoir les rappels Naya.");
        return;
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.expoConfig?.projectId;
      const token = await Notifications.getExpoPushTokenAsync({ projectId });

      await api.post("/api/notifications/register", { expoPushToken: token.data });
      setPushEnabled(true);
      Alert.alert("Notifications activées ✅", "Tu recevras les rappels et jalons débloqués.");
    } catch (err) {
      Alert.alert("Erreur", "Impossible d'activer les notifications.");
    } finally {
      setRegistering(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Déconnexion", "Tu vas être déconnectée.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Se déconnecter",
        style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          try {
            await api.post("/api/auth/logout");
          } catch { /* ignore */ }
          await clearToken();
          queryClient.clear();
          router.replace("/login");
        },
      },
    ]);
  };

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
    : user?.email || "—";

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.firstName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "N"}
          </Text>
        </View>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.email}>{user?.email || ""}</Text>
      </View>

      {/* Section notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="notifications-outline" size={20} color="#818cf8" />
            <View>
              <Text style={styles.rowLabel}>Rappels & jalons</Text>
              <Text style={styles.rowSub}>Notifications push sur iPhone</Text>
            </View>
          </View>
          {registering ? (
            <ActivityIndicator color="#4f46e5" />
          ) : (
            <Switch
              value={pushEnabled}
              onValueChange={(val) => val ? registerPushNotifications() : setPushEnabled(false)}
              trackColor={{ true: "#4f46e5" }}
            />
          )}
        </View>
      </View>

      {/* Section app */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Application</Text>

        <TouchableOpacity style={styles.row} onPress={() => Alert.alert("Cockpit web", "Ouvre Naya depuis ton navigateur pour accéder au cockpit complet.")}>
          <View style={styles.rowLeft}>
            <Ionicons name="desktop-outline" size={20} color="#818cf8" />
            <View>
              <Text style={styles.rowLabel}>Cockpit stratégique</Text>
              <Text style={styles.rowSub}>Disponible sur navigateur desktop</Text>
            </View>
          </View>
          <Ionicons name="open-outline" size={16} color="#64748b" />
        </TouchableOpacity>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="information-circle-outline" size={20} color="#818cf8" />
            <View>
              <Text style={styles.rowLabel}>Version</Text>
              <Text style={styles.rowSub}>Naya 1.0.0</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Déconnexion */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator color="#ef4444" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
              <Text style={styles.logoutText}>Se déconnecter</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: { alignItems: "center", paddingTop: 64, paddingBottom: 32, gap: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  avatarText: { fontSize: 28, color: "#fff", fontWeight: "700" },
  name: { fontSize: 20, fontWeight: "700", color: "#fff" },
  email: { fontSize: 13, color: "#64748b" },
  section: { marginHorizontal: 16, marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: "600", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1e1e2e", borderRadius: 14, padding: 16, marginBottom: 2 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "500", color: "#e2e8f0" },
  rowSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1e1e2e", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#ef444440" },
  logoutText: { fontSize: 15, fontWeight: "600", color: "#ef4444" },
});
