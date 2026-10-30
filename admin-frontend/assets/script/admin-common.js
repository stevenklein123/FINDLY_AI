// Shared helpers for all admin pages.
import { supabase } from "./supabase-client.js";

export const API_URL =
  window.FINDLY_CONFIG?.ADMIN_API_URL || "http://127.0.0.1:5001";
export const LOGIN_URL = "./admin-login.html";

/**
 * Checks whether a user has administrative privileges.
 * Verifies via admins table in Supabase or backend validation.
 */
export async function checkIsAdmin(user) {
  if (!user) return false;
  try {
    const { data: adminRow, error } = await supabase
      .from("admins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("Could not query admins table:", error.message);
      // Fallback: Check user metadata role if present
      return user.user_metadata?.role === "admin";
    }
    return Boolean(adminRow);
  } catch (err) {
    console.warn("Admin check exception:", err);
    return false;
  }
}

/**
 * Ensures user is authenticated and authorized as an Admin.
 * Redirects to LOGIN_URL if unauthenticated or not an admin.
 */
export async function requireAdmin() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    redirectToLogin();
    return null;
  }

  const isAdmin = await checkIsAdmin(session.user);
  if (!isAdmin) {
    // If authenticated as a non-admin, sign out from admin portal and redirect with notice
    await supabase.auth.signOut();
    redirectToLogin("Unauthorized: This account does not have Admin access.");
    return null;
  }

  return session;
}

export function redirectToLogin(message) {
  if (message) {
    sessionStorage.setItem("findly_admin_login_msg", message);
  }
  window.location.replace(LOGIN_URL);
  return null;
}

/**
 * Signs the admin user out and redirects to the Admin Login page.
 */
export async function logoutAdmin() {
  await supabase.auth.signOut();
  redirectToLogin();
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
