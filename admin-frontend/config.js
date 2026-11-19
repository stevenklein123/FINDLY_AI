// Frontend configuration for Findly Admin
// Use ONLY public credentials. NEVER put service_role keys here.

const isLocal =
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost";

window.FINDLY_CONFIG = {
  SUPABASE_URL: "https://ybmqpjlytgwhiuyfhxwl.supabase.co",

  SUPABASE_ANON_KEY: "sb_publishable_ah0svmz4SnE-XR0E-4uMrw_qWvJfdKR",

  ADMIN_API_URL: isLocal
    ? "http://127.0.0.1:5001"
    : "https://findly-admin-api.onrender.com",
};
