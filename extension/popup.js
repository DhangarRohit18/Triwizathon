/**
 * StockPilot AI — Manifest V3 Chrome Extension Companion
 * Robust role-aware integration with FastAPI backend.
 */

// Storage abstraction (supports chrome.storage.local and localStorage for dev)
const Storage = {
  get: async (key) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (res) => resolve(res[key] || null));
      } else {
        resolve(localStorage.getItem(key));
      }
    });
  },
  set: async (key, val) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: val }, resolve);
      } else {
        localStorage.setItem(key, val);
        resolve();
      }
    });
  },
  remove: async (key) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([key], resolve);
      } else {
        localStorage.removeItem(key);
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
let searchDebounceTimer = null;
let pendingConfirmCallback = null;

// DOM Elements
const authView = document.getElementById("authView");
const dashView = document.getElementById("dashView");
const configView = document.getElementById("configView");
const authHeader = document.getElementById("authHeader");
const headerUserName = document.getElementById("headerUserName");
const headerUserRole = document.getElementById("headerUserRole");
const pulseDot = document.getElementById("pulseDot");
const logoutBtn = document.getElementById("logoutBtn");
const configToggleBtn = document.getElementById("configToggleBtn");
const customApiBaseInput = document.getElementById("customApiBase");
const customWebBaseInput = document.getElementById("customWebBase");
const cancelConfigBtn = document.getElementById("cancelConfigBtn");
const saveApiBaseBtn = document.getElementById("saveApiBaseBtn");
const bannerContainer = document.getElementById("bannerContainer");

// Auth Form
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const authOpenDashboardBtn = document.getElementById("authOpenDashboardBtn");
const headerDashboardBtn = document.getElementById("headerDashboardBtn");

// Dashboard Elements
const warehouseSelect = document.getElementById("warehouseSelect");
const refreshBtn = document.getElementById("refreshBtn");
const roleContextTitle = document.getElementById("roleContextTitle");
const roleContextSubtitle = document.getElementById("roleContextSubtitle");
const roleContextBadge = document.getElementById("roleContextBadge");
const roleTabBar = document.getElementById("roleTabBar");
const skuSearchInput = document.getElementById("skuSearchInput");
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
// Helpers: Banners, Health, Escaping, Deep Links
// ---------------------------------------------------------------------------
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

function setOnline(isOnline) {
  if (isOnline) {
    pulseDot.classList.remove("offline");
  } else {
    pulseDot.classList.add("offline");
  }
}

// Reliable URL opener for Chrome Extension (MV3 tabs API or window.open fallback)
function openExternalUrl(url) {
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  } catch (err) {
    console.error("Failed to open external URL:", err);
    window.open(url, "_blank");
  }
}

function updateFooterLinks() {
  if (openWebConsoleBtn && openWebConsoleBtn.tagName === "A") openWebConsoleBtn.href = `${webBase}/`;
  if (openExpressLaneBtn && openExpressLaneBtn.tagName === "A") openExpressLaneBtn.href = `${webBase}/express`;
}

// Authenticated API Fetch
async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(currentToken ? { "Authorization": `Bearer ${currentToken}` } : {}),
    ...(options.headers || {})
  };

  try {
    const res = await fetch(`${apiBase}${path}`, { ...options, headers });
    
    if (res.status === 401) {
      await handleLogout("Session expired. Please sign in again.");
      throw new Error("Unauthorized");
    }

    if (res.status === 403) {
      showBanner("Permission denied: You are not authorized for this action.", "warning");
      throw new Error("Forbidden");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server returned error ${res.status}`);
    }

    setOnline(true);
    return await res.json();
  } catch (e) {
    if (e.message.includes("Failed to fetch") || e.name === "TypeError") {
      setOnline(false);
      showBanner(`Cannot reach StockPilot server at ${apiBase}`, "error");
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// App Boot & Session Management
// ---------------------------------------------------------------------------
async function initApp() {
  clearBanner();

  // Load configured API host and Web host
  const savedBase = await Storage.get("stockpilot_api_base");
  if (savedBase) {
    apiBase = savedBase;
    if (customApiBaseInput) customApiBaseInput.value = savedBase;
  }

  const savedWebBase = await Storage.get("stockpilot_web_base");
  if (savedWebBase) {
    webBase = savedWebBase;
    if (customWebBaseInput) customWebBaseInput.value = savedWebBase;
  }

  updateFooterLinks();

  const token = await Storage.get("stockpilot_token");
  if (!token) {
    showAuthView();
    return;
  }

  currentToken = token;
  try {
    // Validate session with backend
    const profile = await apiFetch("/extension/me");
    currentUser = profile;
    showDashboardView();
  } catch (err) {
    console.warn("Session validation failed:", err);
    showAuthView();
  }
}

function showAuthView() {
  currentToken = null;
  currentUser = null;
  authView.style.display = "block";
  dashView.style.display = "none";
  authHeader.style.display = "none";
  logoutBtn.style.display = "none";
}

function showDashboardView() {
  authView.style.display = "none";
  dashView.style.display = "block";
  authHeader.style.display = "flex";
  logoutBtn.style.display = "inline-block";

  headerUserName.textContent = currentUser.name || "User";
  headerUserRole.textContent = (currentUser.role || "operator").replace("_", " ").toUpperCase();

  updateFooterLinks();
  setupRoleLayout(currentUser.role || "operator");
  loadSummary();
}

async function handleLogout(msg) {
  await Storage.remove("stockpilot_token");
  showAuthView();
  if (msg) showBanner(msg, "warning");
}

// ---------------------------------------------------------------------------
// Role-Specific Architecture & Tab Bar Construction
// ---------------------------------------------------------------------------
const ROLE_TABS = {
  operator: [
    { id: "tabStock", label: "Hub Stock" },
    { id: "tabTasks", label: "My Tasks" },
    { id: "tabAlerts", label: "Storage Alerts" }
  ],
  distributor: [
    { id: "tabOrders", label: "Delivery Manifest" },
    { id: "tabStock", label: "Catalog Availability" },
    { id: "tabAlerts", label: "Alerts" }
  ],
  warehouse_manager: [
    { id: "tabStock", label: "Inventory & Batches" },
    { id: "tabTransfers", label: "Facility Transfers" },
    { id: "tabAlerts", label: "Cold-Chain & Expiry" }
  ],
  supply_chain_manager: [
    { id: "tabStock", label: "Network Stock" },
    { id: "tabTransfers", label: "Transfer Approvals" },
    { id: "tabOptimizer", label: "MIP Optimizer" }
  ],
  org_admin: [
    { id: "tabGovernance", label: "Network Health" },
    { id: "tabStock", label: "Global Matrix" },
    { id: "tabAlerts", label: "Critical Alerts" }
  ],
  super_admin: [
    { id: "tabPlatform", label: "Cluster Platform" },
    { id: "tabGovernance", label: "Tenants & Nodes" },
    { id: "tabAlerts", label: "System Health" }
  ]
};

function setupRoleLayout(role) {
  const roleNameFormatted = role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  roleContextTitle.textContent = `${roleNameFormatted} Workspace`;

  let sub = "Assigned Warehouse Facility";
  if (role === "super_admin" || role === "org_admin" || role === "supply_chain_manager") {
    sub = "Multi-Hub Global Scope";
  } else if (role === "distributor") {
    sub = "Fulfillment & Last-Mile Fleet";
  }
  roleContextSubtitle.textContent = sub;

  // Render Tabs
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
      renderActiveTab();
    };
    roleTabBar.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// Dashboard Data Fetch & Render
// ---------------------------------------------------------------------------
async function loadSummary() {
  clearBanner();
  try {
    const query = activeWarehouseId ? `?warehouse_id=${encodeURIComponent(activeWarehouseId)}` : "";
    const data = await apiFetch(`/extension/summary${query}`);
    currentSummary = data;

    // Warehouses selector population
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

    // KPIs
    kpiItems.textContent = data.stock ? data.stock.length : 0;
    kpiLow.textContent = data.low_stock_count || 0;
    kpiAlerts.textContent = data.active_alerts ? data.active_alerts.length : 0;
    kpiExpiry.textContent = data.expiry_alerts ? data.expiry_alerts.length : 0;

    renderActiveTab();
  } catch (err) {
    console.error("Error loading summary:", err);
  }
}

// Render Content for Currently Selected Role Tab
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

// 1. Stock Tab (Safe DOM)
function renderStockTab(items) {
  if (items.length === 0) {
    renderEmpty("No inventory records found for this facility.");
    return;
  }

  items.forEach(s => {
    const row = document.createElement("div");
    row.className = "list-row";

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
      badge.textContent = "HEALTHY";
    }

    right.appendChild(qty);
    right.appendChild(badge);

    row.appendChild(left);
    row.appendChild(right);
    mainListContainer.appendChild(row);
  });
}

// 2. Real Backend Tasks Tab
async function renderTasksTab() {
  renderEmpty("Loading active tasks...");
  try {
    const tasks = await apiFetch("/tasks");
    mainListContainer.innerHTML = "";
    if (tasks.length === 0) {
      renderEmpty("No pending warehouse floor tasks.");
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
      desc.textContent = `${t.description} • Loc: ${t.target_location}`;

      const foot = document.createElement("div");
      foot.style.display = "flex";
      foot.style.justifyContent = "space-between";
      foot.style.alignItems = "center";
      foot.style.marginTop = "6px";

      const statusSpan = document.createElement("span");
      statusSpan.style.fontSize = "10px";
      statusSpan.style.fontWeight = "600";
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
  } catch (e) {
    renderEmpty("Failed to load warehouse tasks.");
  }
}

// 3. Alerts Tab (IoT + FEFO Expiry)
function renderAlertsTab(iotAlerts, expiryAlerts) {
  if (iotAlerts.length === 0 && expiryAlerts.length === 0) {
    renderEmpty("✓ All warehouse storage sensors and lots are nominal.");
    return;
  }

  // IoT Excursion Cards
  iotAlerts.forEach(a => {
    const card = document.createElement("div");
    card.className = "card-item";
    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("span");
    title.style.color = "var(--rose-text)";
    title.style.fontWeight = "700";
    title.textContent = `⚠️ [${(a.severity || "warning").toUpperCase()}] Cold-Chain Excursion`;
    const time = document.createElement("span");
    time.style.fontSize = "10px";
    time.textContent = (a.timestamp || "").slice(11, 16);
    head.appendChild(title);
    head.appendChild(time);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = a.message;

    const foot = document.createElement("div");
    foot.style.display = "flex";
    foot.style.justifyContent = "space-between";
    foot.style.alignItems = "center";
    foot.style.marginTop = "6px";

    const provSpan = document.createElement("span");
    provSpan.className = a.is_simulated ? "badge badge-amber" : "badge badge-teal";
    provSpan.textContent = a.is_simulated ? "SIMULATED LAB" : "ESP32 LIVE";
    foot.appendChild(provSpan);

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
      ackSpan.textContent = `Ack: ${a.acknowledged_by || "Signed off"}`;
      foot.appendChild(ackSpan);
    }

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(foot);
    mainListContainer.appendChild(card);
  });

  // FEFO Expiry Cards
  expiryAlerts.forEach(e => {
    const card = document.createElement("div");
    card.className = "card-item";
    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("span");
    title.style.fontWeight = "700";
    title.textContent = `⏳ ${e.batch_number} (${e.sku})`;
    const days = document.createElement("span");
    days.className = `badge ${e.is_critical ? "badge-rose" : "badge-amber"}`;
    days.textContent = `${e.days_remaining}d remaining`;
    head.appendChild(title);
    head.appendChild(days);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = `${e.product_name} • ${e.quantity} units (Exp: ${e.expiry_date})`;

    card.appendChild(head);
    card.appendChild(desc);
    mainListContainer.appendChild(card);
  });
}

// 4. Transfers Tab
function renderTransfersTab(transfers) {
  if (transfers.length === 0) {
    renderEmpty("✓ No inter-warehouse transfers pending review.");
    return;
  }

  transfers.forEach(t => {
    const card = document.createElement("div");
    card.className = "card-item";

    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("div");
    title.className = "card-title";
    title.style.color = "var(--teal)";
    title.textContent = t.transfer_number || t.id;

    const btn = document.createElement("button");
    btn.className = "btn-action-small";
    btn.textContent = "Approve";
    btn.onclick = () => confirmTransferApproval(t.id, t.transfer_number || t.id, t.source, t.destination);

    head.appendChild(title);
    head.appendChild(btn);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = `${t.source} ➔ ${t.destination} (${t.items_count} SKUs)`;

    card.appendChild(head);
    card.appendChild(desc);
    mainListContainer.appendChild(card);
  });
}

// 5. Optimizer Tab (Authoritative values only - No fabricated metrics)
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

  const link = document.createElement("a");
  link.target = "_blank";
  link.className = "btn-action-small";
  link.style.display = "inline-block";
  link.style.textDecoration = "none";
  link.href = `${webBase}/optimizer`;

  if (!optSummary || optSummary.status === "no_runs" || !optSummary.run_id) {
    title.textContent = "Optimization Status";
    desc.textContent = "No active optimization run has been generated yet for this cycle.";
    subtext.textContent = "Run the mathematical solver to generate allocation recommendations.";
    link.textContent = "Launch Solver in Web Console ↗";
  } else {
    title.textContent = `Verified Solver Run: ${optSummary.run_id}`;
    
    const allocatedText = optSummary.total_allocated != null ? Number(optSummary.total_allocated).toLocaleString() : "N/A";
    const savingsText = optSummary.cost_savings_pct != null ? `${optSummary.cost_savings_pct}%` : "Calculated";
    
    desc.textContent = `Allocated Units: ${allocatedText} • Cost Savings: ${savingsText}`;
    subtext.textContent = "Cost reduction computed against unoptimized baseline heuristic.";
    link.textContent = "Review Full Distribution Plan ↗";
  }

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(subtext);
  card.appendChild(link);
  mainListContainer.appendChild(card);
}

// 6. Distributor Delivery Tab (Real transfers / manifests via safe DOM)
function renderDistributorOrdersTab() {
  const transfers = currentSummary ? (currentSummary.pending_transfers || []) : [];
  if (transfers.length === 0) {
    renderEmpty("No outbound delivery manifests or transfer dispatches assigned.");
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

    const meta = document.createElement("div");
    meta.style.marginTop = "6px";
    meta.style.fontSize = "10px";
    meta.style.color = "var(--slate-500)";
    meta.textContent = `Requested by: ${t.requested_by || "Logistics"}`;

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(meta);
    mainListContainer.appendChild(card);
  });
}

// 7. Governance & Platform Health Tab (Safe DOM)
function renderGovernanceTab() {
  const card = document.createElement("div");
  card.className = "card-item";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "13px";
  title.style.color = "var(--navy)";
  title.style.marginBottom = "6px";
  title.textContent = "Enterprise Governance & Hub Health";

  const desc = document.createElement("div");
  desc.className = "card-desc";
  desc.style.marginBottom = "8px";
  const orgName = (currentUser && currentUser.org_id) || "Acuity BioLogistics";
  const roleName = (currentUser && currentUser.role) || "Administrator";
  desc.textContent = `Tenant: ${orgName} • Role: ${roleName.replace(/_/g, " ")}`;

  const linksWrap = document.createElement("div");
  linksWrap.style.display = "flex";
  linksWrap.style.gap = "6px";
  linksWrap.style.marginTop = "10px";

  const usersLink = document.createElement("a");
  usersLink.href = `${webBase}/users`;
  usersLink.target = "_blank";
  usersLink.className = "footer-btn";
  usersLink.style.textDecoration = "none";
  usersLink.textContent = "Team Provisioning ↗";

  const expressLink = document.createElement("a");
  expressLink.href = `${webBase}/express`;
  expressLink.target = "_blank";
  expressLink.className = "footer-btn";
  expressLink.style.textDecoration = "none";
  expressLink.textContent = "Express SOS ↗";

  linksWrap.appendChild(usersLink);
  linksWrap.appendChild(expressLink);

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(linksWrap);
  mainListContainer.appendChild(card);
}

function renderEmpty(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  mainListContainer.appendChild(empty);
}

// ---------------------------------------------------------------------------
// Action Confirmation Dialogs
// ---------------------------------------------------------------------------
function confirmTransferApproval(trfId, trfNum, src, dst) {
  modalTitle.textContent = "Confirm Transfer Approval";
  modalBody.textContent = `Are you sure you want to approve urgent transfer ${trfNum} from ${src} to ${dst}? This commits the stock allocation in the authoritative ledger.`;
  confirmModal.style.display = "flex";

  pendingConfirmCallback = async () => {
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
  modalBody.textContent = `Acknowledge excursion "${alertMsg}"? This logs your sign-off in the compliance ledger.`;
  confirmModal.style.display = "flex";

  pendingConfirmCallback = async () => {
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

  pendingConfirmCallback = async () => {
    confirmModal.style.display = "none";
    try {
      await apiFetch(`/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST",
        body: JSON.stringify({ notes: "Completed via Chrome Extension Companion" })
      });
      showBanner(`Task marked as completed!`, "success");
      renderTasksTab();
    } catch (e) {
      showBanner(e.message, "error");
    }
  };
}

modalCancelBtn.onclick = () => { confirmModal.style.display = "none"; pendingConfirmCallback = null; };
modalConfirmBtn.onclick = () => { if (pendingConfirmCallback) pendingConfirmCallback(); };

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------
loginForm.onsubmit = async (e) => {
  e.preventDefault();
  clearBanner();
  loginBtn.disabled = true;
  loginBtn.textContent = "Authenticating...";

  try {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: loginEmail.value.trim().toLowerCase(),
        password: loginPassword.value
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Authentication failed. Check credentials.");
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

if (authOpenDashboardBtn) {
  authOpenDashboardBtn.onclick = () => openExternalUrl(`${webBase}/`);
}

if (headerDashboardBtn) {
  headerDashboardBtn.onclick = () => openExternalUrl(`${webBase}/`);
}

if (openWebConsoleBtn) {
  openWebConsoleBtn.onclick = (e) => {
    e.preventDefault();
    openExternalUrl(`${webBase}/`);
  };
}

if (openExpressLaneBtn) {
  openExpressLaneBtn.onclick = (e) => {
    e.preventDefault();
    openExternalUrl(`${webBase}/express`);
  };
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
  const customApi = customApiBaseInput.value.trim();
  const customWeb = customWebBaseInput ? customWebBaseInput.value.trim() : "";
  if (customApi) {
    apiBase = customApi;
    await Storage.set("stockpilot_api_base", customApi);
  }
  if (customWeb) {
    webBase = customWeb;
    await Storage.set("stockpilot_web_base", customWeb);
  }
  updateFooterLinks();
  configView.style.display = "none";
  showBanner("Configuration saved.", "success");
  if (currentToken) loadSummary();
};

// SKU Search with debouncing
skuSearchInput.oninput = () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    const q = skuSearchInput.value.trim();
    if (q.length < 2) {
      if (currentSummary) renderActiveTab();
      return;
    }

    try {
      const results = await apiFetch(`/extension/search?q=${encodeURIComponent(q)}`);
      mainListContainer.innerHTML = "";
      if (results.length === 0) {
        renderEmpty(`No matching SKUs or batches for "${q}".`);
        return;
      }
      results.forEach(p => {
        const row = document.createElement("div");
        row.className = "list-row";
        const left = document.createElement("div");
        const sku = document.createElement("div");
        sku.className = "item-sku";
        sku.textContent = p.sku;
        const name = document.createElement("div");
        name.className = "item-name";
        name.textContent = `${p.name} (${p.handling})`;
        left.appendChild(sku);
        left.appendChild(name);

        const right = document.createElement("div");
        right.style.textAlign = "right";
        const strong = document.createElement("strong");
        strong.textContent = p.total_available;
        right.appendChild(strong);
        right.appendChild(document.createTextNode(` ${p.unit || "units"}`));

        row.appendChild(left);
        row.appendChild(right);
        mainListContainer.appendChild(row);
      });
    } catch (e) {
      console.warn("Search error:", e);
    }
  }, 300);
};

// Initialize
initApp();
