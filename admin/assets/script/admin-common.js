// Shared helpers for all admin pages.
import { supabase } from "./supabase-client.js";

export const API_URL =
  window.FINDLY_CONFIG?.ADMIN_API_URL || "http://127.0.0.1:5001";
export const LOGIN_URL = "../../index.html";

/** Returns the active session, or redirects to login and returns null. */
export async function requireAdmin() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirectToLogin();
    return null;
  }
  return session;
}

function redirectToLogin() {
  window.location.replace(LOGIN_URL);
  return null;
}

/** Authenticated fetch helper for admin-app.py API endpoints */
export async function adminFetch(path, options = {}) {
  const session = await requireAdmin();
  if (!session) return null;

  const headers = {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || res.statusText || `HTTP ${res.status}`);
  }
  return res.json();
}
