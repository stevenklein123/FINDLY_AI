// Shared helpers for all admin pages.
import { supabase } from "./supabase-client.js";

export const LOGIN_URL = "./login.html";

/** Returns the admin profile row, or redirects to login and returns null. */
export async function requireAdmin() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return redirectToLogin();

  const { data: admin, error } = await supabase
    .from("admins")
    .select("display_name, avatar_url")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !admin) return redirectToLogin();
  return admin;
}

function redirectToLogin() {
  window.location.replace(LOGIN_URL);
  return null;
}

/**
 * Re-run `onChange` whenever any of the given tables change (realtime),
 * and also when the tab becomes visible again, in case an event was missed
 * while the connection was asleep.
 */
export function subscribeToTables(channelName, tables, onChange, delay = 300) {
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, delay);
  };

  const channel = supabase.channel(channelName);
  tables.forEach((table) =>
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      refresh,
    ),
  );
  channel.subscribe();

  const onVisible = () => document.visibilityState === "visible" && refresh();
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    supabase.removeChannel(channel);
  };
}
