/*
 * Findly AI - Report Found Item
 *
 * Replace the two configuration values below with your
 * Supabase project's URL and publishable/anon key.
 */

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const form = document.querySelector("#foundForm");
const photoInput = document.querySelector("#photo");
const preview = document.querySelector("#preview");
const uploadPrompt = document.querySelector("#uploadPrompt");
const removePhotoBtn = document.querySelector("#removePhoto");
const foundAtInput = document.querySelector("#foundAt");
const currentTimeBtn = document.querySelector("#useCurrentTime");
const submitBtn = document.querySelector("#submitBtn");
const message = document.querySelector("#formMessage");

let supabaseClient = null;

// Initialize Supabase only when valid configuration is provided.
if (
  window.supabase &&
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY"
) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  );
}

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `form-message ${type}`;
}

function formatLocalDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function useCurrentTime() {
  foundAtInput.value = formatLocalDateTime();
}

currentTimeBtn.addEventListener("click", useCurrentTime);

// Set the initial date and time.
useCurrentTime();

// Photo preview.
photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];

  showMessage("");

  if (!file) {
    clearPhoto();
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(file.type)) {
    showMessage("Please upload a JPG, PNG, or WEBP image.", "error");
    photoInput.value = "";
    clearPhoto();
    return;
  }

  const maxSize = 5 * 1024 * 1024;

  if (file.size > maxSize) {
    showMessage("The photo must be 5 MB or smaller.", "error");
    photoInput.value = "";
    clearPhoto();
    return;
  }

  const reader = new FileReader();

  reader.onload = (event) => {
    preview.src = event.target.result;
    preview.hidden = false;
    uploadPrompt.hidden = true;
    removePhotoBtn.hidden = false;
  };

  reader.onerror = () => {
    showMessage("Unable to preview this photo. Please try another.", "error");
    clearPhoto();
  };

  reader.readAsDataURL(file);
});

function clearPhoto() {
  preview.removeAttribute("src");
  preview.hidden = true;
  uploadPrompt.hidden = false;
  removePhotoBtn.hidden = true;
}

removePhotoBtn.addEventListener("click", () => {
  photoInput.value = "";
  clearPhoto();
  showMessage("");
});

function getFormData() {
  return {
    item_name: document.querySelector("#item").value.trim(),
    category: document.querySelector("#category").value,
    color: document.querySelector("#color").value.trim(),
    brand: document.querySelector("#brand").value.trim(),
    size: document.querySelector("#size").value.trim(),
    marks: document.querySelector("#marks").value.trim(),
    description: document.querySelector("#description").value.trim(),
    place: document.querySelector("#place").value.trim(),
    occurred_at: new Date(foundAtInput.value).toISOString(),
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const photo = photoInput.files[0];

  if (!photo) {
    showMessage("Please upload a photo of the found item.", "error");
    photoInput.focus();
    return;
  }

  if (!form.reportValidity()) {
    return;
  }

  if (!foundAtInput.value || Number.isNaN(Date.parse(foundAtInput.value))) {
    showMessage("Please select a valid date and time.", "error");
    return;
  }

  if (!supabaseClient) {
    showMessage(
      "Frontend validation works, but Supabase is not configured yet. Add your project URL and anon key in report-found.js.",
      "error",
    );
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError) {
      throw authError;
    }

    if (!user) {
      showMessage("Please sign in before submitting a found item.", "error");
      return;
    }

    const itemData = getFormData();

    // Use a unique filename to reduce the chance of collisions.
    const extension = photo.name.split(".").pop().toLowerCase();
    const photoPath = `${user.id}/${crypto.randomUUID()}.${extension}`;

    // Upload the image to the item-images storage bucket.
    const { error: uploadError } = await supabaseClient.storage
      .from("item-images")
      .upload(photoPath, photo, {
        contentType: photo.type,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    // Store the image path with the found item record.
    // Keep the column names consistent with your Supabase table.
    const { error: insertError } = await supabaseClient
      .from("found_items")
      .insert({
        ...itemData,
        photo_url: photoPath,
        user_id: user.id,
        submitted_by: user.id,
      });

    if (insertError) {
      // Best-effort cleanup if the database insert fails.
      await supabaseClient.storage.from("item-images").remove([photoPath]);

      throw insertError;
    }

    showMessage("Found item submitted successfully!", "success");

    form.reset();
    clearPhoto();
    useCurrentTime();
  } catch (error) {
    console.error("Found item submission failed:", error);

    showMessage(
      error.message || "Something went wrong. Please try again.",
      "error",
    );
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Found Item";
  }
});
