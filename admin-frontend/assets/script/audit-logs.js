import { requireAdmin, adminFetch, logoutAdmin, API_URL } from "./admin-common.js";

// DOM references
const searchInput = document.querySelector("#searchInput");
const adminFilter = document.querySelector("#adminFilter");
const actionFilter = document.querySelector("#actionFilter");
const moduleFilter = document.querySelector("#moduleFilter");
const startDateFilter = document.querySelector("#startDateFilter");
const endDateFilter = document.querySelector("#endDateFilter");
const resetFiltersBtn = document.querySelector("#resetFiltersBtn");
const exportCsvBtn = document.querySelector("#exportCsvBtn");

const tableBody = document.querySelector("#logsTableBody");
const paginationInfo = document.querySelector("#paginationInfo");
const pageIndicator = document.querySelector("#pageIndicator");
const prevPageBtn = document.querySelector("#prevPageBtn");
const nextPageBtn = document.querySelector("#nextPageBtn");
const logoutBtn = document.querySelector("#adminLogoutBtn");

// Modal references
const detailsModal = document.querySelector("#detailsModal");
const closeModalBtn = document.querySelector("#closeModalBtn");
const modalCloseBtnBottom = document.querySelector("#modalCloseBtnBottom");
const modalTimestamp = document.querySelector("#modalTimestamp");
const modalAdmin = document.querySelector("#modalAdmin");
const modalAction = document.querySelector("#modalAction");
const modalModule = document.querySelector("#modalModule");
const modalTargetId = document.querySelector("#modalTargetId");
const modalIp = document.querySelector("#modalIp");
const modalUserAgent = document.querySelector("#modalUserAgent");
const modalDescription = document.querySelector("#modalDescription");
const modalOldValues = document.querySelector("#modalOldValues");
const modalNewValues = document.querySelector("#modalNewValues");

let currentPage = 1;
let totalPages = 1;
let currentLogs = [];
let searchDebounceTimer = null;

function formatDateTime(isoString) {
  if (!isoString) return "--";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

function getActionBadge(action) {
  const act = (action || "").toUpperCase();
  let bgClass = "bg-slate-100 text-slate-700 border-slate-300";

  if (act.includes("LOGIN") && !act.includes("FAILED")) {
    bgClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (act.includes("FAILED")) {
    bgClass = "bg-rose-50 text-rose-700 border-rose-200";
  } else if (act.includes("LOGOUT")) {
    bgClass = "bg-slate-100 text-slate-600 border-slate-200";
  } else if (act.includes("CLAIM")) {
    bgClass = "bg-purple-50 text-purple-700 border-purple-200";
  } else if (act.includes("ITEM")) {
    bgClass = "bg-blue-50 text-blue-700 border-blue-200";
  } else if (act.includes("EXPORT")) {
    bgClass = "bg-amber-50 text-amber-700 border-amber-200";
  }

  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${bgClass}">${escapeHtml(act)}</span>`;
}

function getModuleBadge(module) {
  const mod = (module || "GENERAL").toUpperCase();
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">${escapeHtml(mod)}</span>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFilterParams() {
  const params = new URLSearchParams();
  const search = searchInput?.value.trim();
  const adminEmail = adminFilter?.value.trim();
  const action = actionFilter?.value.trim();
  const module = moduleFilter?.value.trim();
  const startDate = startDateFilter?.value.trim();
  const endDate = endDateFilter?.value.trim();

  if (search) params.set("search", search);
  if (adminEmail) params.set("admin_email", adminEmail);
  if (action) params.set("action", action);
  if (module) params.set("module", module);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);

  return params;
}

async function loadFilterOptions() {
  try {
    const data = await adminFetch("/admin/audit-logs/filters");
    if (!data) return;

    if (adminFilter && data.admin_emails) {
      adminFilter.innerHTML = '<option value="">All Administrators</option>';
      data.admin_emails.forEach((email) => {
        const opt = document.createElement("option");
        opt.value = email;
        opt.textContent = email;
        adminFilter.appendChild(opt);
      });
    }

    if (actionFilter && data.actions) {
      actionFilter.innerHTML = '<option value="">All Actions</option>';
      data.actions.forEach((act) => {
        const opt = document.createElement("option");
        opt.value = act;
        opt.textContent = act;
        actionFilter.appendChild(opt);
      });
    }

    if (moduleFilter && data.modules) {
      moduleFilter.innerHTML = '<option value="">All Modules</option>';
      data.modules.forEach((mod) => {
        const opt = document.createElement("option");
        opt.value = mod;
        opt.textContent = mod;
        moduleFilter.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn("Failed to load audit log filter options:", err);
  }
}

async function loadLogs(page = 1) {
  currentPage = page;
  tableBody.innerHTML = `
    <tr>
      <td colspan="6" class="py-10 text-center text-slate-400">
        <div class="flex items-center justify-center gap-2">
          <svg class="w-5 h-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          <span>Fetching records...</span>
        </div>
      </td>
    </tr>
  `;

  try {
    const params = getFilterParams();
    params.set("page", currentPage);
    params.set("limit", 15);

    const data = await adminFetch(`/admin/audit-logs?${params.toString()}`);
    if (!data || !Array.isArray(data.logs)) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 text-center text-rose-500 font-medium">
            Could not retrieve audit logs.
          </td>
        </tr>
      `;
      return;
    }

    currentLogs = data.logs;
    totalPages = data.pages || 1;

    renderTable(currentLogs, data.total || 0, data.page || 1, data.limit || 15);
  } catch (err) {
    console.error("Error loading audit logs:", err);
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-rose-500 font-medium">
          Error loading logs: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}

function renderTable(logs, total, page, limit) {
  if (!logs.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-slate-400">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span class="font-semibold text-slate-600">No activity logs found</span>
            <span class="text-[11px] text-slate-400">Try adjusting your search or filters</span>
          </div>
        </td>
      </tr>
    `;
    paginationInfo.textContent = "Showing 0 entries";
    pageIndicator.textContent = "Page 1 of 1";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  const startEntry = (page - 1) * limit + 1;
  const endEntry = Math.min(startEntry + logs.length - 1, total);
  paginationInfo.textContent = `Showing ${startEntry}–${endEntry} of ${total} entries`;
  pageIndicator.textContent = `Page ${page} of ${totalPages}`;

  prevPageBtn.disabled = page <= 1;
  nextPageBtn.disabled = page >= totalPages;

  tableBody.innerHTML = logs
    .map((log) => {
      const email = log.admin_email || "System / Unauthenticated";
      const desc = log.description || "--";

      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
            ${formatDateTime(log.created_at)}
          </td>
          <td class="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap">
            ${escapeHtml(email)}
          </td>
          <td class="py-3 px-4 whitespace-nowrap">
            ${getActionBadge(log.action)}
          </td>
          <td class="py-3 px-4 whitespace-nowrap">
            ${getModuleBadge(log.module)}
          </td>
          <td class="py-3 px-4 text-slate-700 max-w-xs md:max-w-md truncate" title="${escapeHtml(desc)}">
            ${escapeHtml(desc)}
          </td>
          <td class="py-3 px-4 text-center whitespace-nowrap">
            <button
              type="button"
              data-log-id="${escapeHtml(log.id)}"
              class="view-details-btn px-2.5 py-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
            >
              View Details
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Attach modal detail buttons
  document.querySelectorAll(".view-details-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const logId = btn.dataset.logId;
      const log = currentLogs.find((l) => String(l.id) === String(logId));
      if (log) openDetailsModal(log);
    });
  });
}

function openDetailsModal(log) {
  modalTimestamp.textContent = formatDateTime(log.created_at);
  modalAdmin.textContent = log.admin_email ? `${log.admin_email} (${log.admin_id || "N/A"})` : "None";
  modalAction.innerHTML = getActionBadge(log.action);
  modalModule.innerHTML = getModuleBadge(log.module);
  modalTargetId.textContent = log.target_id || "None";
  modalIp.textContent = log.ip_address || "--";
  modalUserAgent.textContent = log.user_agent || "--";
  modalUserAgent.title = log.user_agent || "";
  modalDescription.textContent = log.description || "--";

  modalOldValues.textContent = log.old_values ? JSON.stringify(log.old_values, null, 2) : "None";
  modalNewValues.textContent = log.new_values ? JSON.stringify(log.new_values, null, 2) : "None";

  detailsModal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
}

function closeDetailsModal() {
  detailsModal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
}

async function handleExportCsv() {
  const originalText = exportCsvBtn.innerHTML;
  exportCsvBtn.disabled = true;
  exportCsvBtn.innerHTML = `
    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
    </svg>
    Exporting...
  `;

  try {
    const session = await requireAdmin();
    if (!session) return;

    const params = getFilterParams();
    const res = await fetch(`${API_URL}/admin/audit-logs/export?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Export failed (${res.statusText})`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `admin_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Export error:", err);
    alert(`Could not export audit logs: ${err.message}`);
  } finally {
    exportCsvBtn.disabled = false;
    exportCsvBtn.innerHTML = originalText;
  }
}

// Initial setup
(async function init() {
  const session = await requireAdmin();
  if (!session) return;

  // Logout button
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      logoutBtn.textContent = "Signing out...";
      await logoutAdmin();
    });
  }

  // Load initial filter options & first page
  await loadFilterOptions();
  await loadLogs(1);

  // Search input debounced
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadLogs(1);
    }, 350);
  });

  // Filter dropdowns
  adminFilter?.addEventListener("change", () => loadLogs(1));
  actionFilter?.addEventListener("change", () => loadLogs(1));
  moduleFilter?.addEventListener("change", () => loadLogs(1));
  startDateFilter?.addEventListener("change", () => loadLogs(1));
  endDateFilter?.addEventListener("change", () => loadLogs(1));

  // Reset button
  resetFiltersBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (adminFilter) adminFilter.value = "";
    if (actionFilter) actionFilter.value = "";
    if (moduleFilter) moduleFilter.value = "";
    if (startDateFilter) startDateFilter.value = "";
    if (endDateFilter) endDateFilter.value = "";
    loadLogs(1);
  });

  // Export button
  exportCsvBtn?.addEventListener("click", handleExportCsv);

  // Pagination buttons
  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1) loadLogs(currentPage - 1);
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages) loadLogs(currentPage + 1);
  });

  // Modal close buttons
  closeModalBtn?.addEventListener("click", closeDetailsModal);
  modalCloseBtnBottom?.addEventListener("click", closeDetailsModal);
  detailsModal?.addEventListener("click", (e) => {
    if (e.target === detailsModal) closeDetailsModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !detailsModal.classList.contains("hidden")) {
      closeDetailsModal();
    }
  });
})();
