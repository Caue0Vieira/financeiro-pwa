import { createSupabaseService } from "./supabase";

export { createDemoService } from "./demo";

export function configuredBackend() {
  const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
  const key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? createSupabaseService(url, key) : null;
}
