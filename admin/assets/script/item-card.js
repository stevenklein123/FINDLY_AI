// Tiny DOM helper + reusable item card for admin pages.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e5e7eb"/>' +
      '<path d="M30 65l15-18 12 14 8-9 10 13z" fill="#9ca3af"/><circle cx="38" cy="36" r="6" fill="#9ca3af"/></svg>',
  );

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(iso);
  }
};

const fmtTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const field = (label, value) =>
  value ? el("p", {}, el("b", {}, `${label}: `), String(value)) : null;

/**
 * @param {object} item  row from claim_items or found_items
 * @param {"lost"|"found"} kind
 */
export function itemCard(item, kind) {
  if (!item) return el("div", { class: "card" }, "Item details not found");

  const lost = kind === "lost";

  const photo = el("img", {
    class: "card__photo",
    src: item.photo_url || PLACEHOLDER,
    alt: item.item_name || "Item image",
    loading: "lazy",
  });
  photo.addEventListener(
    "error",
    () => {
      photo.src = PLACEHOLDER;
    },
    { once: true },
  );

  return el(
    "article",
    { class: `card card--${kind}` },
    el("div", { class: "card__photo-wrap" }, photo),

    el(
      "div",
      { class: "card__section" },
      el("h3", {}, item.item_name || "Untitled Item"),
      field("Category", item.category?.trim() || "Uncategorized"),
      field("Color", item.color),
      field("Brand", item.brand),
      field("Size", item.size),
      field("Marks", item.marks),
      field("Details", item.description),
    ),

    el(
      "div",
      { class: "card__section" },
      field(lost ? "Lost at" : "Found at", item.place),
      field("Date", fmtDate(item.occurred_at)),
      field("Time", fmtTime(item.occurred_at)),
      field("Status", item.status ? item.status.toUpperCase() : "OPEN"),
      field("Reported by", item.submitted_by),
    ),
  );
}
