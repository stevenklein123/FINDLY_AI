// Landing page interactions + auth UI (intro / register / login dialog).
(function () {
  const $ = (id) => document.getElementById(id);

  const menuBtn = $("menuBtn");
  const nav = $("nav");
  const authBtns = document.querySelectorAll("[data-auth]");
  const navAuth = document.querySelector(".nav-auth");
  const signOutBtn = $("signOutBtn");
  const userChip = $("userChip");
  const userName = $("userName");
  const authDialog = $("authDialog");
  const authMsg = $("authMsg");
  const authError = $("authError");
  const toast = $("toast");
  const googleBtns = [$("googleBtn"), $("googleBtn2")].filter(Boolean);
  const registerForm = $("registerForm");
  const loginForm = $("loginForm");

  // Remember the default intro text so custom messages don't stick.
  const defaultIntroMsg = authMsg.textContent;

  let toastTimer;
  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 3500);
  }

  function showError(message) {
    authError.textContent = message;
    authError.hidden = !message;
  }

  // Mobile menu
  menuBtn.addEventListener("click", () => {
    const open = nav.hidden;
    nav.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A" && window.innerWidth < 720) {
      nav.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
    }
  });
  // Desktop keeps the nav visible; mobile starts collapsed.
  function syncNav() {
    if (window.innerWidth >= 720) nav.hidden = false;
    else if (menuBtn.getAttribute("aria-expanded") !== "true") nav.hidden = true;
  }
  window.addEventListener("resize", syncNav);
  syncNav();

  // Auth UI state
  function renderUser(user) {
    const signedIn = Boolean(user);
    navAuth.hidden = signedIn;
    userChip.hidden = !signedIn;
    if (signedIn) {
      const meta = user.user_metadata || {};
      userName.textContent = meta.full_name || meta.name || user.email || "Signed in";
      if (authDialog.open) authDialog.close();
    }
  }

  // Dialog views: "intro" | "register" | "login"
  function setMode(mode) {
    authDialog.dataset.mode = mode;
    showError("");
  }

  function openAuthDialog(mode = "intro", message) {
    authMsg.textContent = message || defaultIntroMsg;
    setMode(mode);
    if (!authDialog.open && typeof authDialog.showModal === "function") {
      authDialog.showModal();
    }
  }

  authDialog.addEventListener("close", () => showError(""));
  $("authClose")?.addEventListener("click", () => authDialog.close());
  $("startBtn")?.addEventListener("click", () => setMode("register"));
  document.querySelectorAll("[data-switch]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.switch))
  );

  // Show/hide password
  document.querySelectorAll(".pw-toggle").forEach((t) =>
    t.addEventListener("click", () => {
      const input = t.previousElementSibling;
      input.type = input.type === "password" ? "text" : "password";
    })
  );

  // Nav buttons: Register opens the intro card, Login opens the login view.
  authBtns.forEach((b) =>
    b.addEventListener("click", () => {
      if (window.innerWidth < 720) menuBtn.click();
      openAuthDialog(b.dataset.mode === "login" ? "login" : "intro");
    })
  );

  // Google sign-in (both buttons share the same handler)
  async function startGoogleSignIn() {
    showError("");
    googleBtns.forEach((b) => (b.disabled = true));
    const { error } = await FindlyAuth.signInWithGoogle();
    googleBtns.forEach((b) => (b.disabled = false));
    if (error) showError(error.message || "Could not start Google sign-in. Try again.");
    // On success the browser redirects to Google, then back to this page.
  }
  googleBtns.forEach((b) => b.addEventListener("click", startGoogleSignIn));

  function setBusy(form, busy) {
    form.querySelectorAll("button").forEach((b) => (b.disabled = busy));
  }

  // Register with email + password
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const f = new FormData(registerForm);
    const name = String(f.get("name") || "").trim();
    const studentNo = String(f.get("studentNo") || "").trim();
    const email = String(f.get("email") || "").trim();
    const password = String(f.get("password") || "");

    if (!name || !studentNo || !email || !password) {
      return showError("Please fill in all fields.");
    }
    if (password.length < 6) {
      return showError("Password must be at least 6 characters.");
    }

    setBusy(registerForm, true);
    const { data, error } = await FindlyAuth.signUpWithEmail({ name, studentNo, email, password });
    setBusy(registerForm, false);

    if (error) return showError(error.message);

    // Supabase returns an empty identities list when the email is already registered.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return showError("This email is already registered. Please log in.");
    }

    registerForm.reset();
    if (!data.session) {
      // Email confirmation is on: no session yet, so stay on the landing page.
      authDialog.close();
      showToast("Account created. Check your email to confirm it, then log in.");
    } else {
      window.location.href = "student.html";
    }
  });

  // Login with email + password
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const f = new FormData(loginForm);
    const email = String(f.get("email") || "").trim();
    const password = String(f.get("password") || "");

    if (!email || !password) return showError("Enter your email and password.");

    setBusy(loginForm, true);
    const { error } = await FindlyAuth.signInWithEmail({ email, password });
    setBusy(loginForm, false);

    if (error) {
      return showError(
        error.message === "Invalid login credentials"
          ? "Wrong email or password."
          : error.message
      );
    }
    loginForm.reset();
    window.location.href = "student.html";
  });

  signOutBtn.addEventListener("click", async () => {
    await FindlyAuth.signOut();
    sessionStorage.removeItem("findly_intent");
    renderUser(null);
    showToast("You’ve signed out.");
  });

  // "I lost something" / "I found something"
  async function handleIntent(intent) {
    // Always remember what they wanted so student.html can open the right form.
    sessionStorage.setItem("findly_intent", intent);

    const user = await FindlyAuth.getUser();

    if (!user) {
      // NOT logged in: show the "Hi QCUian! / Get Started" card. No redirect.
      openAuthDialog("intro");
      return;
    }

    // Logged in: go to the report page.
    window.location.href = "student.html";
  }
  document.querySelectorAll("[data-intent]").forEach((btn) =>
    btn.addEventListener("click", () => handleIntent(btn.dataset.intent))
  );

  // After a sign-in (including the Google redirect), continue what the
  // person started before signing in. Only runs if they clicked lost/found.
  function resumeIntent(user) {
    if (user && sessionStorage.getItem("findly_intent")) {
      window.location.href = "student.html"; // student.html reads and clears the intent
    }
  }

  // Init
  if (!FindlyAuth.configured) {
    console.warn("Findly AI: add your Supabase URL and anon key in config.js.");
  }

  FindlyAuth.getUser().then((user) => {
    renderUser(user);
    resumeIntent(user);
    // Clean the OAuth hash/query left in the URL after redirect.
    if (user && (location.hash.includes("access_token") || location.search.includes("code="))) {
      history.replaceState({}, document.title, location.pathname);
    }
  });

  FindlyAuth.onAuthChange((user) => {
    renderUser(user);
    resumeIntent(user);
  });
})();