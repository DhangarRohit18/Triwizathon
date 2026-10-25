/**
 * StockPilot AI — Context-Aware Supply Chain Copilot (Manifest V3)
 * 
 * Architectural Guarantees:
 * 1. The backend database is the sole authoritative source of truth.
 * 2. Strictly role-authorized: actions and scopes are validated server-side.
 * 3. Never fabricates credentials, demo tokens, solver results, or inventory state.
 * 4. Rich context-aware search: multi-attribute lookup, FEFO batch intelligence, debounced with AbortController.
 * 5. Passive page-context extraction: non-privileged, user-confirmed.
 * 6. Safe DOM rendering using textContent and programmatic elements.
 */

// Storage abstraction (supports chrome.storage.local with localStorage fallback for local dev)
const Storage = {
  get: async (key) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (res) => resolve(res[key] || null));
      } else {
        try { resolve(localStorage.getItem(key)); } catch (_) { resolve(null); }
      }
    });
  },
  set: async (key, val) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: val }, resolve);
      } else {
        try { localStorage.setItem(key, val); } catch (_) {}
        resolve();
      }
    });
  },
  remove: async (key) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([key], resolve);
      } else {
        try { localStorage.removeItem(key); } catch (_) {}
        resolve();
      }
    });
  }
};

// Global State
let apiBase = "http://localhost:8000/api/v1";
let webBase = "http://localhost:5173";
let currentToken = null;
let currentUser = null;
let currentSummary = null;
let activeWarehouseId = null;
let currentRoleTab = "tabStock";
let searchAbortController = null;
let searchDebounceTimer = null;
let pendingConfirmAction = null;
let lastSyncDate = null;

// DOM Elements
const authView = document.getElementById("authView");
const dashView = document.getElementById("dashView");
const configView = document.getElementById("configView");
const authHeader = document.getElementById("authHeader");
const headerUserName = document.getElementById("headerUserName");
const headerUserRole = document.getElementById("headerUserRole");
const pulseDot = document.getElementById("pulseDot");
const syncStatusBar = document.getElementById("syncStatusBar");
const syncStatusText = document.getElementById("syncStatusText");
const syncTimestamp = document.getElementById("syncTimestamp");
const logoutBtn = document.getElementById("logoutBtn");
const configToggleBtn = document.getElementById("configToggleBtn");
const customApiBaseInput = document.getElementById("customApiBase");
const customWebBaseInput = document.getElementById("customWebBase");
const cancelConfigBtn = document.getElementById("cancelConfigBtn");
const saveApiBaseBtn = document.getElementById("saveApiBaseBtn");
const bannerContainer = document.getElementById("bannerContainer");
const headerDashboardBtn = document.getElementById("headerDashboardBtn");

// Page Context Detection Elements
const contextDetectedBar = document.getElementById("contextDetectedBar");
const contextDetectedIdentifier = document.getElementById("contextDetectedIdentifier");
const contextInspectBtn = document.getElementById("contextInspectBtn");
const contextDismissBtn = document.getElementById("contextDismissBtn");

// Auth Form
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");

// Dashboard Elements
const warehouseSelect = document.getElementById("warehouseSelect");
const refreshBtn = document.getElementById("refreshBtn");
const roleTabBar = document.getElementById("roleTabBar");
const skuSearchInput = document.getElementById("skuSearchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const mainListContainer = document.getElementById("mainListContainer");
const kpiItems = document.getElementById("kpiItems");
const kpiLow = document.getElementById("kpiLow");
const kpiAlerts = document.getElementById("kpiAlerts");
const kpiExpiry = document.getElementById("kpiExpiry");

// Modal Elements
const confirmModal = document.getElementById("confirmModal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");

// Deep Link Footer Elements
const openWebConsoleBtn = document.getElementById("openWebConsoleBtn");
const openExpressLaneBtn = document.getElementById("openExpressLaneBtn");

// ---------------------------------------------------------------------------
// Helpers: URL Sanitization, Safe External Links, Banners, Timestamps
// ---------------------------------------------------------------------------
function sanitizeUrl(rawUrl, defaultUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return defaultUrl;
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed.replace(/\/+$/, "");
    }
  } catch (_) {}
  return defaultUrl;
}

function openExternalUrl(url) {
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function") {
      chrome.tabs.create({ url, active: true }, () => {
        if (chrome.runtime.lastError) window.open(url, "_blank");
      });
      return;
    }
  } catch (err) {
    console.warn("chrome.tabs.create unavailable, using window.open fallback:", err);
  }
  const win = window.open(url, "_blank");
  if (!win) window.location.href = url;
}

function showBanner(message, type = "error") {
  bannerContainer.innerHTML = "";
  const banner = document.createElement("div");
  banner.className = `banner ${type}`;

  const span = document.createElement("span");
  span.textContent = message;
  banner.appendChild(span);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-btn";
  closeBtn.style.color = "inherit";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => banner.remove();
  banner.appendChild(closeBtn);

  bannerContainer.appendChild(banner);
}

function clearBanner() {
  bannerContainer.innerHTML = "";
}

function setOnline(isOnline, customText = null) {
  if (isOnline) {
    pulseDot.classList.remove("offline");
    pulseDot.title = "Backend Online";
    if (syncStatusText) syncStatusText.textContent = customText || "Connected • Authoritative Ledger";
  } else {
    pulseDot.classList.add("offline");
    pulseDot.title = "Backend Unreachable";
    if (syncStatusText) syncStatusText.textContent = customText || "Disconnected • Server Offline";
  }
}

function updateSyncTimestamp() {
  lastSyncDate = new Date();
  if (syncTimestamp) {
    syncTimestamp.textContent = `Synced: ${lastSyncDate.toLocaleTimeString()}`;
  }
}

// ---------------------------------------------------------------------------
// Authenticated API Transport
// ---------------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(currentToken ? { "Authorization": `Bearer ${currentToken}` } : {}),
    ...(options.headers || {})
  };

  try {
    const res = await fetch(`${apiBase}${path}`, { ...options, headers });

    if (res.status === 401) {
      await handleLogout("Your session has expired or is invalid. Please sign in again.");
      throw new Error("Unauthorized");
    }

    if (res.status === 403) {
      const err = await res.json().catch(() => ({}));
      const msg = err.detail || "Access forbidden. Your role does not permit this action.";
      showBanner(msg, "warning");
      throw new Error(msg);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server returned status ${res.status}`);
    }

    setOnline(true);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw err; // Let caller handle aborts silently
    }
    if (err.message.includes("Failed to fetch") || err.name === "TypeError") {
      setOnline(false, "Connection error");
      showBanner(`Cannot connect to StockPilot server at ${apiBase}`, "error");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Application Lifecycle & Auth
// ---------------------------------------------------------------------------
async function initApp() {
  clearBanner();

  // Load configured origins with strict sanitization
  const savedApi = await Storage.get("stockpilot_api_base");
  apiBase = sanitizeUrl(savedApi, "http://localhost:8000/api/v1");
  if (customApiBaseInput) customApiBaseInput.value = apiBase;

  const savedWeb = await Storage.get("stockpilot_web_base");
  webBase = sanitizeUrl(savedWeb, "http://localhost:5173");
  if (customWebBaseInput) customWebBaseInput.value = webBase;

  const token = await Storage.get("stockpilot_token");
  if (!token) {
    showAuthView();
    return;
  }

  currentToken = token;
  try {
    // Validate session with authoritative backend
    const profile = await apiFetch("/extension/me");
    currentUser = profile;
    showDashboardView();
  } catch (err) {
    console.warn("Session validation failed on boot:", err);
    showAuthView();
  }
}

function showAuthView() {
  currentToken = null;
  currentUser = null;
  currentSummary = null;
  if (authView) authView.style.display = "block";
  if (dashView) dashView.style.display = "none";
  if (authHeader) authHeader.style.display = "none";
  if (syncStatusBar) syncStatusBar.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "none";
  if (contextDetectedBar) contextDetectedBar.style.display = "none";
}

function showDashboardView() {
  if (authView) authView.style.display = "none";
  if (dashView) dashView.style.display = "flex";
  if (authHeader) authHeader.style.display = "flex";
  if (syncStatusBar) syncStatusBar.style.display = "flex";
  if (logoutBtn) logoutBtn.style.display = "inline-block";

  if (headerUserName) headerUserName.textContent = currentUser.name || "Operator";
  if (headerUserRole) {
    const roleKey = (currentUser.role || "operator").toLowerCase();
    headerUserRole.textContent = roleKey.replace(/_/g, " ").toUpperCase();
  }

  setupRoleLayout(currentUser.role || "operator");
  loadSummary();
  checkForPageContext();
}

async function handleLogout(msg = null) {
  await Storage.remove("stockpilot_token");
  showAuthView();
  if (msg) showBanner(msg, "warning");
}

// ---------------------------------------------------------------------------
// Context-Aware Page Extraction Integration
// ---------------------------------------------------------------------------
function checkForPageContext() {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const activeTab = tabs[0];
    if (!activeTab.url) return;

    // Check if active tab belongs to supported internal origins
    const isSupportedOrigin = (
      activeTab.url.includes("localhost:5173") ||
      activeTab.url.includes("127.0.0.1:5173") ||
      activeTab.url.includes("stockpilot.ai")
    );
    if (!isSupportedOrigin) return;

    // Send non-privileged query to content script
    try {
      chrome.tabs.sendMessage(activeTab.id, { action: "EXTRACT_PAGE_CONTEXT" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.detected) {
          if (contextDetectedBar) contextDetectedBar.style.display = "none";
          return;
        }

        const detected = res.detected;
        if (contextDetectedIdentifier && contextDetectedBar) {
          contextDetectedIdentifier.textContent = `${detected.type}: ${detected.value}`;
          contextDetectedBar.style.display = "flex";

          contextInspectBtn.onclick = () => {
            skuSearchInput.value = detected.value;
            triggerProductSearch(detected.value);
            contextDetectedBar.style.display = "none";
          };
          contextDismissBtn.onclick = () => {
            contextDetectedBar.style.display = "none";
          };
        }
      });
    } catch (_) {}
  });
}

// ---------------------------------------------------------------------------
// Role-Based Access Control & Navigation
// ---------------------------------------------------------------------------
const ROLE_TABS = {
  operator: [
    { id: "tabStock", label: "Hub Stock" },
    { id: "tabTasks", label: "Floor Tasks" },
    { id: "tabAlerts", label: "Storage Alerts" }
  ],
  distributor: [
    { id: "tabOrders", label: "Delivery Dispatches" },
    { id: "tabStock", label: "Catalog Availability" },
    { id: "tabAlerts", label: "Alerts" }
  ],
  warehouse_manager: [
    { id: "tabStock", label: "Inventory & Batches" },
    { id: "tabTransfers", label: "Facility Transfers" },
    { id: "tabAlerts", label: "Cold-Chain & Expiry" }
  ],
  supply_chain_manager: [
    { id: "tabStock", label: "Network Inventory" },
    { id: "tabTransfers", label: "Transfer Approvals" },
    { id: "tabOptimizer", label: "OR-Tools Solver" }
  ],
  org_admin: [
    { id: "tabGovernance", label: "Network Health" },
    { id: "tabStock", label: "Global Matrix" },
    { id: "tabAlerts", label: "Critical Alerts" }
  ],
  super_admin: [
    { id: "tabPlatform", label: "Platform Diagnostics" },
    { id: "tabGovernance", label: "Nodes & Tenants" },
    { id: "tabAlerts", label: "System Alerts" }
  ]
};

function setupRoleLayout(role) {
  const tabs = ROLE_TABS[role] || ROLE_TABS.operator;
  roleTabBar.innerHTML = "";
  currentRoleTab = tabs[0].id;

  tabs.forEach((t, idx) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${idx === 0 ? "active" : ""}`;
    btn.textContent = t.label;
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentRoleTab = t.id;
      // Clear active search query when explicitly switching tabs
      if (skuSearchInput) skuSearchInput.value = "";
      if (searchClearBtn) searchClearBtn.style.display = "none";
      renderActiveTab();
    };
    roleTabBar.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// Dashboard Data Fetch & Refresh
// ---------------------------------------------------------------------------
async function loadSummary() {
  clearBanner();
  try {
    const query = activeWarehouseId ? `?warehouse_id=${encodeURIComponent(activeWarehouseId)}` : "";
    const data = await apiFetch(`/extension/summary${query}`);
    currentSummary = data;

    // Populate authorized warehouses selector
    if (data.available_warehouses && data.available_warehouses.length > 0) {
      warehouseSelect.innerHTML = "";
      data.available_warehouses.forEach(w => {
        const opt = document.createElement("option");
        opt.value = w.id;
        opt.textContent = `${w.name} (${w.city || "Hub"})`;
        if (w.id === data.warehouse.id) opt.selected = true;
        warehouseSelect.appendChild(opt);
      });
      activeWarehouseId = data.warehouse.id;
    }

    // Authoritative KPIs
    if (kpiItems) kpiItems.textContent = data.stock ? data.stock.length : 0;
    if (kpiLow) kpiLow.textContent = data.low_stock_count || 0;
    if (kpiAlerts) kpiAlerts.textContent = data.active_alerts ? data.active_alerts.length : 0;
    if (kpiExpiry) kpiExpiry.textContent = data.expiry_alerts ? data.expiry_alerts.length : 0;

    updateSyncTimestamp();
    renderActiveTab();
  } catch (err) {
    console.error("Error loading summary:", err);
  }
}

function renderActiveTab() {
  if (!currentSummary) return;
  mainListContainer.innerHTML = "";

  switch (currentRoleTab) {
    case "tabStock":
      renderStockTab(currentSummary.stock || []);
      break;
    case "tabTasks":
      renderTasksTab();
      break;
    case "tabAlerts":
      renderAlertsTab(currentSummary.active_alerts || [], currentSummary.expiry_alerts || []);
      break;
    case "tabTransfers":
      renderTransfersTab(currentSummary.pending_transfers || []);
      break;
    case "tabOptimizer":
      renderOptimizerTab(currentSummary.recommendations_summary);
      break;
    case "tabOrders":
      renderDistributorOrdersTab();
      break;
    case "tabGovernance":
    case "tabPlatform":
      renderGovernanceTab();
      break;
    default:
      renderStockTab(currentSummary.stock || []);
  }
}

// ---------------------------------------------------------------------------
// 1. Stock / Catalog Tab (Safe DOM)
// ---------------------------------------------------------------------------
function renderStockTab(items) {
  if (items.length === 0) {
    renderEmpty("No inventory records found for this facility.");
    return;
  }

  items.forEach(s => {
    const row = document.createElement("div");
    row.className = "list-row";
    row.style.cursor = "pointer";
    row.title = "Click to inspect item intelligence";
    row.onclick = () => {
      skuSearchInput.value = s.sku;
      triggerProductSearch(s.sku);
    };

    const left = document.createElement("div");
    const sku = document.createElement("div");
    sku.className = "item-sku";
    sku.textContent = s.sku;
    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = `${s.name} (${s.handling || "standard"})`;
    left.appendChild(sku);
    left.appendChild(name);

    const right = document.createElement("div");
    right.style.textAlign = "right";
    const qty = document.createElement("div");
    qty.style.fontWeight = "700";
    qty.textContent = `${s.available} ${s.unit || "units"}`;

    const badge = document.createElement("span");
    badge.className = "badge";
    if (s.is_stockout) {
      badge.classList.add("badge-rose");
      badge.textContent = "STOCKOUT";
    } else if (s.is_low) {
      badge.classList.add("badge-amber");
      badge.textContent = "LOW STOCK";
    } else {
      badge.classList.add("badge-green");
      badge.textContent = "IN STOCK";
    }

    right.appendChild(qty);
    right.appendChild(badge);

    row.appendChild(left);
    row.appendChild(right);
    mainListContainer.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// 2. Real Floor Tasks Tab (Authoritative Workflow)
// ---------------------------------------------------------------------------
async function renderTasksTab() {
  renderEmpty("Loading warehouse operational tasks...");
  try {
    const path = activeWarehouseId
      ? `/extension/tasks?warehouse_id=${encodeURIComponent(activeWarehouseId)}`
      : "/extension/tasks";
    const tasks = await apiFetch(path);
    mainListContainer.innerHTML = "";
    if (!tasks || tasks.length === 0) {
      renderEmpty("✓ No pending warehouse floor tasks for this hub.");
      return;
    }

    tasks.forEach(t => {
      const card = document.createElement("div");
      card.className = "card-item";

      const head = document.createElement("div");
      head.className = "card-head";
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = t.title;

      const priorityBadge = document.createElement("span");
      priorityBadge.className = `badge ${t.priority === "URGENT" || t.priority === "HIGH" ? "badge-rose" : "badge-amber"}`;
      priorityBadge.textContent = t.priority;
      head.appendChild(title);
      head.appendChild(priorityBadge);

      const desc = document.createElement("div");
      desc.className = "card-desc";
      desc.textContent = `${t.description} • Target Loc: ${t.target_location}`;

      const foot = document.createElement("div");
      foot.style.display = "flex";
      foot.style.justifyContent = "space-between";
      foot.style.alignItems = "center";
      foot.style.marginTop = "6px";

      const statusSpan = document.createElement("span");
      statusSpan.style.fontSize = "10px";
      statusSpan.style.fontWeight = "700";
      statusSpan.textContent = `Status: ${t.status}`;

      if (t.status !== "COMPLETED") {
        const compBtn = document.createElement("button");
        compBtn.className = "btn-action-small";
        compBtn.textContent = "Complete Task";
        compBtn.onclick = () => confirmTaskComplete(t.id, t.title);
        foot.appendChild(statusSpan);
        foot.appendChild(compBtn);
      } else {
        statusSpan.style.color = "var(--green-text)";
        foot.appendChild(statusSpan);
      }

      card.appendChild(head);
      card.appendChild(desc);
      card.appendChild(foot);
      mainListContainer.appendChild(card);
    });
  } catch (err) {
    renderEmpty("Failed to load tasks from server.");
  }
}

// ---------------------------------------------------------------------------
// 3. Alerts Tab (IoT Cold-Chain Telemetry + FEFO Expiry)
// ---------------------------------------------------------------------------
function renderAlertsTab(iotAlerts, expiryAlerts) {
  if (iotAlerts.length === 0 && expiryAlerts.length === 0) {
    renderEmpty("✓ All warehouse storage sensors and batch lots are nominal.");
    return;
  }

  // IoT Sensor Excursion Alerts
  iotAlerts.forEach(a => {
    const card = document.createElement("div");
    card.className = "card-item";

    const head = document.createElement("div");
    head.className = "card-head";

    const title = document.createElement("span");
    title.style.color = "var(--rose-text)";
    title.style.fontWeight = "700";
    title.textContent = `⚠️ [${(a.severity || "HIGH").toUpperCase()}] ${a.alert_type || "Excursion"}`;

    const time = document.createElement("span");
    time.style.fontSize = "10px";
    time.style.color = "var(--slate-500)";
    time.textContent = (a.timestamp || "").slice(11, 16) || "Now";

    head.appendChild(title);
    head.appendChild(time);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    let readingText = a.message;
    if (a.reading_value != null && a.threshold_value != null) {
      readingText = `${a.message} (Measured: ${a.reading_value}°C vs Limit: ${a.threshold_value}°C)`;
    }
    desc.textContent = readingText;

    const foot = document.createElement("div");
    foot.style.display = "flex";
    foot.style.justifyContent = "space-between";
    foot.style.alignItems = "center";
    foot.style.marginTop = "6px";

    const tagsWrap = document.createElement("div");
    tagsWrap.style.display = "flex";
    tagsWrap.style.gap = "4px";

    const provSpan = document.createElement("span");
    provSpan.className = a.is_simulated ? "badge badge-amber" : "badge badge-teal";
    provSpan.textContent = a.is_simulated ? "SIMULATED LAB" : "ESP32 LIVE";
    tagsWrap.appendChild(provSpan);

    if (a.is_stale) {
      const staleBadge = document.createElement("span");
      staleBadge.className = "badge badge-rose";
      staleBadge.textContent = "STALE DATA (>2H)";
      tagsWrap.appendChild(staleBadge);
    }
    foot.appendChild(tagsWrap);

    if (!a.acknowledged) {
      const ackBtn = document.createElement("button");
      ackBtn.className = "btn-action-small";
      ackBtn.textContent = "Acknowledge";
      ackBtn.onclick = () => confirmAlertAcknowledge(a.id, a.message);
      foot.appendChild(ackBtn);
    } else {
      const ackSpan = document.createElement("span");
      ackSpan.style.fontSize = "10px";
      ackSpan.style.color = "var(--slate-500)";
      ackSpan.textContent = `Ack: ${a.acknowledged_by || "Verified"}`;
      foot.appendChild(ackSpan);
    }

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(foot);
    mainListContainer.appendChild(card);
  });

  // FEFO Batch Expiry Alerts
  expiryAlerts.forEach(e => {
    const card = document.createElement("div");
    card.className = "card-item";

    const head = document.createElement("div");
    head.className = "card-head";

    const title = document.createElement("span");
    title.style.fontWeight = "700";
    title.textContent = `⏳ Batch ${e.batch_number} (${e.sku})`;

    const daysBadge = document.createElement("span");
    daysBadge.className = `badge ${e.is_critical ? "badge-rose" : "badge-amber"}`;
    daysBadge.textContent = `${e.days_remaining}d to expiry`;

    head.appendChild(title);
    head.appendChild(daysBadge);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = `${e.product_name} • ${e.quantity} units (Expiry: ${e.expiry_date})`;

    card.appendChild(head);
    card.appendChild(desc);
    mainListContainer.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// 4. Transfers Tab (Authorized Approvals Only)
// ---------------------------------------------------------------------------
function renderTransfersTab(transfers) {
  if (transfers.length === 0) {
    renderEmpty("✓ No inter-warehouse transfers pending approval.");
    return;
  }

  const role = (currentUser && currentUser.role) || "operator";
  const canApprove = (
    role === "super_admin" ||
    role === "org_admin" ||
    role === "supply_chain_manager" ||
    role === "warehouse_manager"
  );

  transfers.forEach(t => {
    const card = document.createElement("div");
    card.className = "card-item";

    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("div");
    title.className = "card-title";
    title.style.color = "var(--teal)";
    title.textContent = t.transfer_number || t.id;

    head.appendChild(title);

    if (canApprove) {
      const btn = document.createElement("button");
      btn.className = "btn-action-small";
      btn.textContent = "Approve";
      btn.onclick = () => confirmTransferApproval(t.id, t.transfer_number || t.id, t.source, t.destination);
      head.appendChild(btn);
    } else {
      const badge = document.createElement("span");
      badge.className = "badge badge-amber";
      badge.textContent = "PENDING SCM APPROVAL";
      head.appendChild(badge);
    }

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = `${t.source} ➔ ${t.destination} (${t.items_count} SKUs)`;

    card.appendChild(head);
    card.appendChild(desc);
    mainListContainer.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// 5. Optimizer Tab (Authoritative OR-Tools Verification)
// ---------------------------------------------------------------------------
function renderOptimizerTab(optSummary) {
  const card = document.createElement("div");
  card.className = "card-item";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "13px";
  title.style.color = "var(--navy)";
  title.style.marginBottom = "4px";

  const desc = document.createElement("div");
  desc.className = "card-desc";
  desc.style.marginBottom = "8px";

  const subtext = document.createElement("div");
  subtext.style.fontSize = "10px";
  subtext.style.color = "var(--slate-500)";
  subtext.style.marginBottom = "12px";

  const link = document.createElement("button");
  link.type = "button";
  link.className = "btn-action-small";
  link.textContent = "Review Full Plan in Web Console ↗";
  link.onclick = () => openExternalUrl(`${webBase}/optimizer`);

  if (!optSummary || optSummary.status === "no_runs" || !optSummary.run_id) {
    title.textContent = "OR-Tools Solver Status";
    desc.textContent = "No optimization run recorded yet for this active billing cycle.";
    subtext.textContent = "Run the linear programming solver in the web dashboard to produce recommendations.";
  } else {
    title.textContent = `Verified Optimizer Run: ${optSummary.run_id}`;
    const allocated = optSummary.total_allocated != null ? Number(optSummary.total_allocated).toLocaleString() : "N/A";
    const savings = optSummary.cost_savings_pct != null ? `${optSummary.cost_savings_pct}%` : "Calculated";
    desc.textContent = `Allocated Units: ${allocated} • Expected Cost Savings: ${savings}`;
    subtext.textContent = `Status: ${(optSummary.status || "COMPLETED").toUpperCase()} • Created: ${(optSummary.created_at || "").slice(0, 16)}`;
  }

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(subtext);
  card.appendChild(link);
  mainListContainer.appendChild(card);
}

// ---------------------------------------------------------------------------
// 6. Distributor Delivery Manifest Tab
// ---------------------------------------------------------------------------
function renderDistributorOrdersTab() {
  const transfers = currentSummary ? (currentSummary.pending_transfers || []) : [];
  if (transfers.length === 0) {
    renderEmpty("No active transfer dispatches or delivery manifests found.");
    return;
  }

  transfers.forEach(t => {
    const card = document.createElement("div");
    card.className = "card-item";

    const head = document.createElement("div");
    head.className = "card-head";

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = `Manifest ${t.transfer_number || t.id}`;

    const badge = document.createElement("span");
    badge.className = "badge badge-green";
    badge.textContent = (t.status || "DISPATCHED").toUpperCase();

    head.appendChild(title);
    head.appendChild(badge);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = `Route: ${t.source} ➔ ${t.destination} • Items: ${t.items_count} SKUs`;

    card.appendChild(head);
    card.appendChild(desc);
    mainListContainer.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// 7. Governance & System Diagnostics Tab
// ---------------------------------------------------------------------------
function renderGovernanceTab() {
  const card = document.createElement("div");
  card.className = "card-item";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "13px";
  title.style.color = "var(--navy)";
  title.style.marginBottom = "6px";
  title.textContent = "Organization Administration & Telemetry Health";

  const desc = document.createElement("div");
  desc.className = "card-desc";
  desc.style.marginBottom = "10px";
  const org = (currentUser && currentUser.org_id) || "StockPilot Org";
  const role = (currentUser && currentUser.role) || "org_admin";
  desc.textContent = `Tenant ID: ${org} • Session Role: ${role.replace(/_/g, " ").toUpperCase()}`;

  const linksWrap = document.createElement("div");
  linksWrap.style.display = "flex";
  linksWrap.style.gap = "6px";

  const usersBtn = document.createElement("button");
  usersBtn.type = "button";
  usersBtn.className = "footer-btn";
  usersBtn.textContent = "Team Provisioning ↗";
  usersBtn.onclick = () => openExternalUrl(`${webBase}/users`);

  const auditBtn = document.createElement("button");
  auditBtn.type = "button";
  auditBtn.className = "footer-btn";
  auditBtn.textContent = "Audit Log ↗";
  auditBtn.onclick = () => openExternalUrl(`${webBase}/audit`);

  linksWrap.appendChild(usersBtn);
  linksWrap.appendChild(auditBtn);

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(linksWrap);
  mainListContainer.appendChild(card);
}

function renderEmpty(text) {
  mainListContainer.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  mainListContainer.appendChild(empty);
}

// ---------------------------------------------------------------------------
// Context-Aware Multi-Attribute Product Search & Intelligence
// ---------------------------------------------------------------------------
async function triggerProductSearch(query) {
  const q = (query || "").trim();
  if (q.length < 1) {
    if (searchClearBtn) searchClearBtn.style.display = "none";
    renderActiveTab();
    return;
  }

  if (searchClearBtn) searchClearBtn.style.display = "block";

  // Cancel prior in-flight search request to avoid stale overwrites
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  renderEmpty(`Searching inventory ledger for "${q}"...`);

  try {
    const results = await apiFetch(`/extension/search?q=${encodeURIComponent(q)}`, {
      signal: searchAbortController.signal
    });

    mainListContainer.innerHTML = "";
    if (!results || results.length === 0) {
      renderEmpty(`No matching products, barcodes, or batches found for "${q}".`);
      return;
    }

    results.forEach(p => {
      const card = document.createElement("div");
      card.className = "product-intelligence-card";

      // Card Header
      const head = document.createElement("div");
      head.className = "pi-header";

      const titleWrap = document.createElement("div");
      const title = document.createElement("div");
      title.className = "pi-title";
      title.textContent = p.name;

      const sku = document.createElement("div");
      sku.className = "pi-sku";
      sku.textContent = `SKU: ${p.sku} ${p.barcode ? `• Barcode: ${p.barcode}` : ""}`;

      titleWrap.appendChild(title);
      titleWrap.appendChild(sku);

      // Status Pill
      const statusPill = document.createElement("span");
      statusPill.className = "badge";
      if (p.stock_status === "CRITICAL_STOCKOUT") {
        statusPill.classList.add("badge-rose");
        statusPill.textContent = "CRITICAL STOCKOUT";
      } else if (p.stock_status === "CRITICAL_LOW" || p.stock_status === "LOW_STOCK") {
        statusPill.classList.add("badge-amber");
        statusPill.textContent = "LOW STOCK";
      } else {
        statusPill.classList.add("badge-green");
        statusPill.textContent = "IN STOCK";
      }

      head.appendChild(titleWrap);
      head.appendChild(statusPill);

      // Metric Grid
      const grid = document.createElement("div");
      grid.className = "pi-grid";

      const m1 = document.createElement("div");
      const v1 = document.createElement("div");
      v1.className = "pi-metric-val";
      v1.textContent = `${p.total_available} ${p.unit}`;
      const l1 = document.createElement("div");
      l1.className = "pi-metric-lbl";
      l1.textContent = "Available";
      m1.appendChild(v1);
      m1.appendChild(l1);

      const m2 = document.createElement("div");
      const v2 = document.createElement("div");
      v2.className = "pi-metric-val";
      v2.textContent = `${p.total_reserved} ${p.unit}`;
      const l2 = document.createElement("div");
      l2.className = "pi-metric-lbl";
      l2.textContent = "Reserved";
      m2.appendChild(v2);
      m2.appendChild(l2);

      const m3 = document.createElement("div");
      const v3 = document.createElement("div");
      v3.className = "pi-metric-val";
      v3.textContent = p.reorder_point;
      const l3 = document.createElement("div");
      l3.className = "pi-metric-lbl";
      l3.textContent = "Reorder Pt";
      m3.appendChild(v3);
      m3.appendChild(l3);

      grid.appendChild(m1);
      grid.appendChild(m2);
      grid.appendChild(m3);

      card.appendChild(head);
      card.appendChild(grid);

      // Warehouse stock breakdown
      if (p.warehouses && p.warehouses.length > 0) {
        const whTitle = document.createElement("div");
        whTitle.style.fontSize = "10px";
        whTitle.style.fontWeight = "700";
        whTitle.style.color = "var(--slate-700)";
        whTitle.style.marginBottom = "2px";
        whTitle.textContent = "Authorized Facility Inventory:";
        card.appendChild(whTitle);

        const table = document.createElement("table");
        table.className = "pi-subtable";
        table.innerHTML = `
          <thead>
            <tr>
              <th>Facility</th>
              <th style="text-align: right;">Available</th>
              <th style="text-align: right;">Reserved</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        const tbody = table.querySelector("tbody");
        p.warehouses.forEach(w => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${w.warehouse_name}</td>
            <td style="text-align: right; font-weight: 700;">${w.available} ${p.unit}</td>
            <td style="text-align: right;">${w.reserved}</td>
          `;
          tbody.appendChild(tr);
        });
        card.appendChild(table);
      }

      // Relevant FEFO Batches
      if (p.batches && p.batches.length > 0) {
        const batchTitle = document.createElement("div");
        batchTitle.style.fontSize = "10px";
        batchTitle.style.fontWeight = "700";
        batchTitle.style.color = "var(--slate-700)";
        batchTitle.style.marginTop = "6px";
        batchTitle.style.marginBottom = "2px";
        batchTitle.textContent = "Active FEFO Batches:";
        card.appendChild(batchTitle);

        const bTable = document.createElement("table");
        bTable.className = "pi-subtable";
        bTable.innerHTML = `
          <thead>
            <tr>
              <th>Batch #</th>
              <th>Expiry</th>
              <th>Bin</th>
              <th style="text-align: right;">Qty</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        const bBody = bTable.querySelector("tbody");
        p.batches.forEach(b => {
          const tr = document.createElement("tr");
          const expiryTag = b.days_remaining != null ? `(${b.days_remaining}d)` : "";
          const nearClass = b.is_near_expiry ? "style='color: var(--rose-text); font-weight: 700;'" : "";
          tr.innerHTML = `
            <td><strong>${b.batch_number}</strong></td>
            <td ${nearClass}>${b.expiry_date || "N/A"} ${expiryTag}</td>
            <td>${b.storage_bin}</td>
            <td style="text-align: right; font-weight: 700;">${b.quantity}</td>
          `;
          bBody.appendChild(tr);
        });
        card.appendChild(bTable);
      }

      // Deep Link to Web Console
      const footerRow = document.createElement("div");
      footerRow.style.display = "flex";
      footerRow.style.justifyContent = "flex-end";
      footerRow.style.marginTop = "8px";

      const inspectLink = document.createElement("button");
      inspectLink.type = "button";
      inspectLink.className = "btn-action-small";
      inspectLink.textContent = "Inspect in Web Console ↗";
      inspectLink.onclick = () => openExternalUrl(`${webBase}${p.web_console_url}`);
      footerRow.appendChild(inspectLink);

      card.appendChild(footerRow);
      mainListContainer.appendChild(card);
    });
  } catch (err) {
    if (err.name !== "AbortError") {
      renderEmpty(`Search request failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Action Confirmation Dialogs
// ---------------------------------------------------------------------------
function confirmTransferApproval(trfId, trfNum, src, dst) {
  modalTitle.textContent = "Confirm Transfer Approval";
  modalBody.textContent = `Are you sure you want to approve urgent transfer ${trfNum} from ${src} to ${dst}? This commits stock reservations in the authoritative ledger.`;
  confirmModal.style.display = "flex";

  pendingConfirmAction = async () => {
    confirmModal.style.display = "none";
    try {
      await apiFetch(`/extension/approve-transfer/${encodeURIComponent(trfId)}`, { method: "POST" });
      showBanner(`Transfer ${trfNum} successfully approved!`, "success");
      loadSummary();
    } catch (e) {
      showBanner(e.message, "error");
    }
  };
}

function confirmAlertAcknowledge(alertId, alertMsg) {
  modalTitle.textContent = "Confirm Alert Acknowledgment";
  modalBody.textContent = `Acknowledge excursion "${alertMsg}"? This logs your operator signature in the compliance ledger.`;
  confirmModal.style.display = "flex";

  pendingConfirmAction = async () => {
    confirmModal.style.display = "none";
    try {
      await apiFetch(`/extension/acknowledge-alert/${encodeURIComponent(alertId)}`, { method: "POST" });
      showBanner("Excursion alert acknowledged and recorded.", "success");
      loadSummary();
    } catch (e) {
      showBanner(e.message, "error");
    }
  };
}

function confirmTaskComplete(taskId, taskTitle) {
  modalTitle.textContent = "Confirm Task Completion";
  modalBody.textContent = `Mark "${taskTitle}" as completed on warehouse floor?`;
  confirmModal.style.display = "flex";

  pendingConfirmAction = async () => {
    confirmModal.style.display = "none";
    try {
      await apiFetch(`/extension/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST"
      });
      showBanner(`Task marked as completed!`, "success");
      renderTasksTab();
    } catch (e) {
      showBanner(e.message, "error");
    }
  };
}

modalCancelBtn.onclick = () => {
  confirmModal.style.display = "none";
  pendingConfirmAction = null;
};
modalConfirmBtn.onclick = () => {
  if (pendingConfirmAction) pendingConfirmAction();
};

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------
loginForm.onsubmit = async (e) => {
  e.preventDefault();
  clearBanner();

  const email = (loginEmail.value || "").trim().toLowerCase();
  const password = loginPassword.value || "";

  if (!email || !password) {
    showBanner("Please enter both email and password.", "warning");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Authenticating...";

  try {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Authentication failed. Invalid email or password.");
    }

    const data = await res.json();
    currentToken = data.access_token;
    await Storage.set("stockpilot_token", currentToken);

    currentUser = await apiFetch("/extension/me");
    showDashboardView();
  } catch (err) {
    showBanner(err.message, "error");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Authenticate Session";
  }
};

logoutBtn.onclick = () => handleLogout();
refreshBtn.onclick = () => loadSummary();
warehouseSelect.onchange = () => {
  activeWarehouseId = warehouseSelect.value;
  loadSummary();
};

if (headerDashboardBtn) {
  headerDashboardBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openExternalUrl(`${webBase}/`);
  });
}

if (openWebConsoleBtn) {
  openWebConsoleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openExternalUrl(`${webBase}/`);
  });
}

if (openExpressLaneBtn) {
  openExpressLaneBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openExternalUrl(`${webBase}/express`);
  });
}

configToggleBtn.onclick = () => {
  configView.style.display = configView.style.display === "none" ? "block" : "none";
};

if (cancelConfigBtn) {
  cancelConfigBtn.onclick = () => {
    configView.style.display = "none";
  };
}

saveApiBaseBtn.onclick = async () => {
  const customApi = (customApiBaseInput.value || "").trim();
  const customWeb = (customWebBaseInput.value || "").trim();

  const validApi = sanitizeUrl(customApi, apiBase);
  const validWeb = sanitizeUrl(customWeb, webBase);

  apiBase = validApi;
  webBase = validWeb;

  await Storage.set("stockpilot_api_base", validApi);
  await Storage.set("stockpilot_web_base", validWeb);

  configView.style.display = "none";
  showBanner("Configuration updated and verified.", "success");
  if (currentToken) loadSummary();
};

// Search Debouncing & Clear Handling
skuSearchInput.oninput = () => {
  clearTimeout(searchDebounceTimer);
  const q = skuSearchInput.value.trim();
  if (searchClearBtn) {
    searchClearBtn.style.display = q.length > 0 ? "block" : "none";
  }
  searchDebounceTimer = setTimeout(() => {
    triggerProductSearch(q);
  }, 300);
};

if (searchClearBtn) {
  searchClearBtn.onclick = () => {
    skuSearchInput.value = "";
    searchClearBtn.style.display = "none";
    if (searchAbortController) searchAbortController.abort();
    renderActiveTab();
  };
}

// Boot application
initApp();
