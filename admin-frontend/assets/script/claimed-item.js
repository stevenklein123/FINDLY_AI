import { requireAdmin, adminFetch } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

const list = document.querySelector("#list");
const categorySelect = document.querySelector("#category");

const CATEGORIES = [
  "Electronics",
  "Personal Items",
  "School Supplies",
  "Clothing & Accessories",
  "Bags",
  "Documents & IDs",
  "Keys",
  "Water Bottles & Food Containers",
  "Sports Equipment",
  "Other",
];

const UNCATEGORIZED = "__uncategorized__";
let claimedItems = [];

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const message = (text, isError = false) => {
  if (list) {
    list.replaceChildren(
      el("p", { class: `status${isError ? " status--error" : ""}` }, text),
    );
  }
};

function claimedPanel(match) {
  const badge = el("span", { class: "badge", title: "Claimed" });
  badge.innerHTML = CHECK_SVG;

  return el(
    "section",
    { class: "pair pair--claimed" },
    itemCard(match.lost_items, "lost"),
    itemCard(match.found_items, "found"),
    badge,
  );
}

function fillCategories() {
  if (!categorySelect) return;

  const items = claimedItems.flatMap((match) => [
    match.lost_items,
    match.found_items,
  ]);

  const categories = [
    ...new Set(items.map((item) => item?.category?.trim()).filter(Boolean)),
  ];

  const legacyCategories = categories
    .filter((category) => !CATEGORIES.includes(category))
    .sort((a, b) => a.localeCompare(b));

  const hasUncategorized = items.some((item) => !item?.category?.trim());

  const current = categorySelect.value;

  categorySelect.replaceChildren(
    el("option", { value: "" }, "Category"),
    ...CATEGORIES.map((category) =>
      el("option", { value: category }, category),
    ),
    ...legacyCategories.map((category) =>
      el("option", { value: category }, category),
    ),
    ...(hasUncategorized
      ? [el("option", { value: UNCATEGORIZED }, "Uncategorized")]
      : []),
  );

  categorySelect.value =
    current === UNCATEGORIZED && hasUncategorized
      ? current
      : CATEGORIES.includes(current) || legacyCategories.includes(current)
        ? current
        : "";
}

function renderClaimed() {
  if (!list) return;

  const category = categorySelect?.value || "";

  const visible = !category
    ? claimedItems
    : claimedItems.filter((match) => {
        const categories = [match.lost_items, match.found_items].map((item) =>
          item?.category?.trim(),
        );

        return category === UNCATEGORIZED
          ? categories.some((value) => !value)
          : categories.includes(category);
      });

  if (!visible.length) {
    return message(
      claimedItems.length
        ? "No claimed items found for this category."
        : "Nothing has been claimed yet.",
    );
  }

  list.replaceChildren(...visible.map(claimedPanel));
}

async function loadClaimed() {
  message("Loading claimed items from server…");

  try {
    const data = await adminFetch("/admin/list/claimed");

    if (!Array.isArray(data)) {
      return message("Failed to parse claimed items from backend.", true);
    }

    claimedItems = data;

    fillCategories();
    renderClaimed();
  } catch (err) {
    console.error("Claimed items load error:", err);
    message(`Could not load claimed items: ${err.message}`, true);
  }
}

// Populate default categories immediately.
fillCategories();

categorySelect?.addEventListener("change", renderClaimed);

(async function init() {
  const session = await requireAdmin();

  if (!session) return;

  await loadClaimed();
})();
