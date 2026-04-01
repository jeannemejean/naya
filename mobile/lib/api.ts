import axios from "axios";
import { getToken } from "./auth";

// En dev local : l'API tourne sur le Mac, l'app Expo Go accède via l'IP LAN.
// Sur Railway en prod, utiliser l'URL publique.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

const api = axios.create({ baseURL: BASE_URL, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
