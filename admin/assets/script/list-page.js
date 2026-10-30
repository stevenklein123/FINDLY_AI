// Shared logic for Missing Items and Found Items list pages.
import { requireAdmin, adminFetch } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

/**
 * @param {{listKind: "missing_items"|"found_items", kind: "lost"|"found"}} opts
 */
export async function initItemListPage({ listKind, kind }) {
  const session = await requireAdmin();
  if (!session) return;

  const list = document.querySelector("#list");
  const select = document.querySelector("#category");
  let items = [];

  const message = (text, isError = false) => {
    if (list) {
      list.replaceChildren(
        el("p", { class: `status${isError ? " status--error" : ""}` }, text),
      );
    }
  };

  function fillCategories() {
    if (!select) return;
    const current = select.value;
    const categories = [
      ...new Set(items.map((i) => i.category?.trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    select.replaceChildren(
      el("option", { value: "" }, "Category"),
      ...categories.map((c) => el("option", { value: c }, c)),
    );
    select.value = categories.includes(current) ? current : "";
  }

  function render() {
    if (!list) return;
    const visible = select?.value
      ? items.filter((i) => i.category?.trim() === select.value)
      : items;

    if (!visible.length) {
      return message("No items found.");
    }
    list.replaceChildren(...visible.map((item) => itemCard(item, kind)));
  }

  async function load() {
    message("Loading items from server…");
    try {
      const data = await adminFetch(`/admin/list/${listKind}`);
      if (!Array.isArray(data)) {
        return message("Failed to parse items from backend.", true);
      }
      items = data;
      fillCategories();
      render();
    } catch (err) {
      console.error("List load error:", err);
      message(`Could not load items: ${err.message}`, true);
    }
  }

  if (select) {
    select.addEventListener("change", render);
  }

  await load();
}
