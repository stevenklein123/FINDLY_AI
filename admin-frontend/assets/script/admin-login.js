import { supabase } from "./supabase-client.js";
import { checkIsAdmin } from "./admin-common.js";

const form = document.querySelector("#adminLoginForm");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const submitBtn = document.querySelector("#loginSubmitBtn");
const errorBox = document.querySelector("#loginError");

function showError(msg) {
  if (!errorBox) return;
  if (!msg) {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  } else {
    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");
  }
}

// Check for redirect error messages (e.g., unauthorized student attempt)
const storedMsg = sessionStorage.getItem("findly_admin_login_msg");
if (storedMsg) {
  showError(storedMsg);
  sessionStorage.removeItem("findly_admin_login_msg");
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const email = emailInput?.value.trim();
  const password = passwordInput?.value;

  if (!email || !password) {
    return showError("Please enter both email and password.");
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Verifying...";

  try {
    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In to Dashboard";
      return showError(
        authError.message === "Invalid login credentials"
          ? "Incorrect email or password."
          : authError.message
      );
    }

    const user = authData?.user;
    if (!user) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In to Dashboard";
      return showError("Unable to retrieve user details.");
    }

    // 2. Verify admin authorization
    const isAdmin = await checkIsAdmin(user);
    if (!isAdmin) {
      // User is authenticated in Supabase but is NOT an authorized admin
      await supabase.auth.signOut();
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In to Dashboard";
      return showError(
        "Access Denied: This account is not authorized as an Administrator."
      );
    }

    // 3. Authorized -> proceed to Admin Dashboard
    window.location.replace("./admin-dashboard.html");
  } catch (err) {
    console.error("Admin login error:", err);
    showError(err.message || "An unexpected error occurred during login.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In to Dashboard";
  }
});
