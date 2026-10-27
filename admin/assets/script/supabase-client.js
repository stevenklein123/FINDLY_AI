const config = window.FINDLY_CONFIG;

if (!window.supabase?.createClient) {
  throw new Error("Supabase JS did not load. Check the Supabase CDN script.");
}

if (
  !config?.SUPABASE_URL ||
  !config?.SUPABASE_ANON_KEY ||
  config.SUPABASE_URL.includes("YOUR-PROJECT-REF")
) {
  throw new Error("Supabase is not configured. Add valid values to config.js.");
}

export const supabase = window.supabase.createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY,
);
