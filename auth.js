// Supabase Auth (Google OAuth + email/password). Requires config.js and the supabase-js CDN script first.
(function () {
  const cfg = window.FINDLY_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT-REF");

  const client = configured
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  const notConfigured = () => ({
    data: null,
    error: new Error("Supabase is not configured. Edit config.js."),
  });

  // Must be listed under Supabase > Authentication > URL Configuration > Redirect URLs
const redirectUrl = () =>
  window.location.origin +
  window.location.pathname.replace(/[^/]*$/, "") +
  "student.html";
  async function signInWithGoogle() {
    if (!client) return notConfigured();
    return client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl(),
        queryParams: { prompt: "select_account" },
      },
    });
  }

  // Name and student number are saved in the user's metadata.
  async function signUpWithEmail({ name, studentNo, email, password }) {
    if (!client) return notConfigured();
    return client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, student_no: studentNo },
        emailRedirectTo: redirectUrl(),
      },
    });
  }

  async function signInWithEmail({ email, password }) {
    if (!client) return notConfigured();
    return client.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    if (!client) return { error: null };
    return client.auth.signOut();
  }

  async function getUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session ? data.session.user : null;
  }

  function onAuthChange(callback) {
    if (!client) return;
    client.auth.onAuthStateChange((_event, session) => {
      callback(session ? session.user : null);
    });
  }

  window.FindlyAuth = {
    client, 
    configured,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    signOut,
    getUser,
    onAuthChange,
  };
})();