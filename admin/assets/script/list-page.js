// Shared logic for the Missing Items and Found Items pages.
import { supabase } from "./supabase-client.js";
import { requireAdmin, subscribeToTables } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

/**
 * @param {{view: string, table: string, kind: "lost"|"found"}} opts
 *   view  - admin view to read from
 *   table - base table to watch for realtime changes
 */
export async function initItemListPage({ view, table, kind }) {
  if (!(await requireAdmin())) return;

  const list = document.querySelector("#list");
  const select = document.querySelector("#category");
  let items = [];

  const message = (text, isError = false) =>
    list.replaceChildren(
      el("p", { class: `status${isError ? " status--error" : ""}` }, text),
    );

  function fillCategories() {
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
    const visible = select.value
      ? items.filter((i) => i.category?.trim() === select.value)
      : items;

    if (!visible.length) return message("No items to show.");
    list.replaceChildren(...visible.map((item) => itemCard(item, kind)));
  }

  async function load() {
    const { data, error } = await supabase
      .from(view)
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) return message(`Couldn't load items: ${error.message}`, true);
    items = data;
    fillCategories();
    render();
  }

  select.addEventListener("change", render);
  message("Loading…");
  await load();
  subscribeToTables(`${table}-list`, [table], load);
}
