// Tiny DOM helper + the reusable item card.
// Everything is built with textContent/text nodes, so user-submitted text can't inject HTML.

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

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });

const fmtTime = (iso) =>
  new Date(iso)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();

const field = (label, value) =>
  value ? el("p", {}, el("b", {}, `${label}: `), value) : null;

/**
 * @param {object} item  row from admin_found_items / admin_missing_items
 * @param {"lost"|"found"} kind
 */
export function itemCard(item, kind) {
  const lost = kind === "lost";

  const photo = el("img", {
    class: "card__photo",
    src: item.photo_url || PLACEHOLDER,
    alt: item.item_name,
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
      el("h3", {}, item.item_name),
      field("Color", item.color),
      field("Classification", item.category),
      field("Details", item.description),
      field("Additional details", item.marks),
      field("Brand", item.brand),
      field("Size", item.size),
      field(`Date ${kind}`, fmtDate(item.occurred_at)),
      field(`Time ${kind}`, fmtTime(item.occurred_at)),
    ),

    el(
      "div",
      { class: "card__section" },
      el("h3", {}, item.full_name || "Unknown student"),
      field("Year & Section", item.year_section),
      field("Student No", item.student_no),
      lost ? field("Email", item.email) : null,
      field("Course", item.course),
      field(`Where the item was ${kind}`, item.place),
    ),
  );
}
