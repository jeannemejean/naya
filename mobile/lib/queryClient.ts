import { QueryClient } from "@tanstack/react-query";
import api from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min
      retry: 1,
    },
  },
});

// Fetcher par défaut : prend l'URL comme queryKey[0]
export async function defaultFetcher(url: string) {
  const { data } = await api.get(url);
  return data;
}
