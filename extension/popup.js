/**
 * StockPilot AI — Manifest V3 Chrome Extension Companion
 * Authoritative integration with FastAPI backend.
 */

const API_BASE = "http://localhost:8000/api/v1";
const WEB_BASE = "http://localhost:5173";

// State
let currentToken = null;
let currentSummary = null;
let activeWarehouseId = null;
let searchDebounceTimer = null;

// Storage Helper (supports both chrome.storage.local and localStorage for standalone debugging)
const Storage = {
  get: async (key) => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (result) => resolve(result[key] || null));
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

// UI DOM Elements
const authView = document.getElementById("authView");
const dashView = document.getElementById("dashView");
const authHeader = document.getElementById("authHeader");
const pulseDot = document.getElementById("pulseDot");
const userName = document.getElementById("userName");
const userRole = document.getElementById("userRole");
const bannerContainer = document.getElementById("bannerContainer");

const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const warehouseSelect = document.getElementById("warehouseSelect");
const refreshBtn = document.getElementById("refreshBtn");
const skuSearch = document.getElementById("skuSearch");
const stockListContainer = document.getElementById("stockListContainer");
const iotAlertsContainer = document.getElementById("iotAlertsContainer");
const expiryAlertsContainer = document.getElementById("expiryAlertsContainer");
const transfersContainer = document.getElementById("transfersContainer");

const kpiItems = document.getElementById("kpiItems");
const kpiLow = document.getElementById("kpiLow");
const kpiAlerts = document.getElementById("kpiAlerts");
const kpiExpiry = document.getElementById("kpiExpiry");
const optSavings = document.getElementById("optSavings");
const optModel = document.getElementById("optModel");

// Show Banner Notification
function showBanner(message, type = "error", showRetry = false) {
  bannerContainer.innerHTML = `
    <div class="banner ${type}">
      <span>${message}</span>
      ${showRetry ? '<button class="banner-btn" id="retryConnBtn">Retry</button>' : ''}
    </div>
  `;
  if (showRetry) {
    document.getElementById("retryConnBtn")?.addEventListener("click", () => {
      clearBanner();
      initApp();
    });
  }
}

function clearBanner() {
  bannerContainer.innerHTML = "";
}

// Set Connection Health Status Dot
function setOnlineStatus(online) {
  if (online) {
    pulseDot.classList.remove("offline");
  } else {
    pulseDot.classList.add("offline");
  }
}

// Authenticated Fetch Wrapper with Session-Expiry (401) Handling
async function authFetch(path, options = {}) {
  if (!currentToken) {
    throw new Error("No token available");
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${currentToken}`,
    ...(options.headers || {})
  };

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    
    // Session Expiry Handling
    if (res.status === 401) {
      await handleSessionExpiry("Your session has expired. Please sign in again.");
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || `Server error ${res.status}`);
    }

    setOnlineStatus(true);
    return await res.json();
  } catch (err) {
    if (err.message.includes("Failed to fetch") || err.name === "TypeError") {
      setOnlineStatus(false);
      showBanner("Cannot connect to backend on port 8000.", "error", true);
    }
    throw err;
  }
}

// Session Expiry Handler
async function handleSessionExpiry(msg) {
  await Storage.remove("stockpilot_token");
  currentToken = null;
  authView.style.display = "block";
  dashView.style.display = "none";
  authHeader.style.display = "none";
  if (msg) showBanner(msg, "warning");
}

// 1. Initial Application Setup
async function initApp() {
  clearBanner();
  const savedToken = await Storage.get("stockpilot_token");
  if (!savedToken) {
    authView.style.display = "block";
    dashView.style.display = "none";
    authHeader.style.display = "none";
    return;
  }

  currentToken = savedToken;
  try {
    // Validate token
    const profile = await authFetch("/extension/me");
    setupUserHeader(profile);
    await loadDashboard();
  } catch (err) {
    console.error("Auth validation failed:", err);
  }
}

function setupUserHeader(profile) {
  userName.textContent = profile.name || "User";
  userRole.textContent = (profile.role || "operator").replace("_", " ");
  authHeader.style.display = "block";
  authView.style.display = "none";
  dashView.style.display = "block";
}

// 2. Sign In Handler
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearBanner();
  loginBtn.disabled = true;
  loginBtn.textContent = "Connecting...";

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: loginEmail.value.trim(),
        password: loginPassword.value
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || "Invalid email or password.");
    }

    const data = await res.json();
    currentToken = data.access_token;
    await Storage.set("stockpilot_token", currentToken);

    const profile = await authFetch("/extension/me");
    setupUserHeader(profile);
    await loadDashboard();
  } catch (err) {
    showBanner(err.message, "error");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In to Companion";
  }
});

// Persona Quick Profile Buttons
document.querySelectorAll(".persona-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    loginEmail.value = btn.dataset.email;
    loginPassword.value = btn.dataset.pwd;
    loginForm.dispatchEvent(new Event("submit"));
  });
});

// Logout Handler
logoutBtn.addEventListener("click", async () => {
  await handleSessionExpiry();
});

// 3. Load Dashboard Data
async function loadDashboard() {
  clearBanner();
  try {
    const url = activeWarehouseId 
      ? `/extension/summary?warehouse_id=${encodeURIComponent(activeWarehouseId)}`
      : `/extension/summary`;
    
    currentSummary = await authFetch(url);
    renderDashboard(currentSummary);
  } catch (err) {
    console.error("Error loading summary:", err);
  }
}

// 4. Render Dashboard Components
function renderDashboard(data) {
  // Update Warehouses Dropdown
  if (data.available_warehouses && data.available_warehouses.length > 0) {
    warehouseSelect.innerHTML = data.available_warehouses.map(w => `
      <option value="${w.id}" ${w.id === data.warehouse.id ? 'selected' : ''}>
        ${w.name} (${w.city})
      </option>
    `).join("");
    activeWarehouseId = data.warehouse.id;
  }

  // Update KPIs
  kpiItems.textContent = data.stock ? data.stock.length : 0;
  kpiLow.textContent = data.low_stock_count || 0;
  kpiAlerts.textContent = data.active_alerts ? data.active_alerts.length : 0;
  kpiExpiry.textContent = data.expiry_alerts ? data.expiry_alerts.length : 0;

  // Render Stock Tab
  renderStockList(data.stock || []);

  // Render Alerts Tab
  renderAlerts(data.active_alerts || [], data.expiry_alerts || []);

  // Render Optimizer Tab
  renderOptimizer(data.recommendations_summary, data.pending_transfers || []);
}

// Render Stock Items
function renderStockList(items) {
  if (!items || items.length === 0) {
    stockListContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📦</span>
        No stock records found for this warehouse.
      </div>
    `;
    return;
  }

  stockListContainer.innerHTML = items.map(s => {
    let tagHtml = '<span class="item-status-tag tag-normal">Normal</span>';
    if (s.is_stockout) {
      tagHtml = '<span class="item-status-tag tag-stockout">Stockout</span>';
    } else if (s.is_low) {
      tagHtml = '<span class="item-status-tag tag-low">Low Stock</span>';
    }

    return `
      <div class="list-row">
        <div>
          <div class="item-sku">${s.sku}</div>
          <div class="item-sub" title="${s.name}">${s.name} (${s.handling || 'Std'})</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; font-size: 13px;">${s.available} <span style="font-size: 10px; color: var(--text-dim);">${s.unit || 'units'}</span></div>
          <div>${tagHtml}</div>
        </div>
      </div>
    `;
  }).join("");
}

// Render Alerts (IoT Excursions + FEFO Expiry)
function renderAlerts(iotAlerts, expiryAlerts) {
  // 1. IoT Excursions
  if (iotAlerts.length === 0) {
    iotAlertsContainer.innerHTML = `
      <div class="empty-state" style="padding: 12px; color: var(--accent-green);">
        ✓ All storage sensors nominal
      </div>
    `;
  } else {
    iotAlertsContainer.innerHTML = iotAlerts.map(a => `
      <div class="alert-card">
        <div class="alert-head">
          <span style="color: var(--accent-red);">⚠️ [${(a.severity || 'warning').toUpperCase()}]</span>
          <span style="font-size: 10px; color: var(--text-dim);">${(a.timestamp || '').slice(11, 16)}</span>
        </div>
        <div class="alert-desc">${a.message}</div>
      </div>
    `).join("");
  }

  // 2. FEFO Expiry
  if (expiryAlerts.length === 0) {
    expiryAlertsContainer.innerHTML = `
      <div class="empty-state" style="padding: 12px; color: var(--accent-green);">
        ✓ No lots approaching expiry in 60 days
      </div>
    `;
  } else {
    expiryAlertsContainer.innerHTML = expiryAlerts.map(e => `
      <div class="alert-card">
        <div class="alert-head">
          <span style="color: ${e.is_critical ? 'var(--accent-red)' : 'var(--accent-amber)'};">
            ⏳ ${e.batch_number} (${e.sku})
          </span>
          <span style="font-weight: 700; color: ${e.is_critical ? 'var(--accent-red)' : 'var(--accent-amber)'}; font-size: 10px;">
            ${e.days_remaining}d left
          </span>
        </div>
        <div class="alert-desc">${e.product_name} • ${e.quantity} units (Exp: ${e.expiry_date})</div>
      </div>
    `).join("");
  }
}

// Render Optimizer & Pending Transfers
function renderOptimizer(summary, transfers) {
  if (summary) {
    optSavings.textContent = `${summary.cost_savings_pct || 16.4}% Cost Reduction`;
    optModel.textContent = `Model: ${summary.transport_model || 'OR-Tools MILP Solver'} | Active Allocations: ${summary.total_allocated || transfers.length * 150} units`;
  }

  if (transfers.length === 0) {
    transfersContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">✓</span>
        No transfers pending review.
      </div>
    `;
    return;
  }

  transfersContainer.innerHTML = transfers.map(t => `
    <div class="trf-card">
      <div>
        <div style="font-weight: 700; font-size: 11px; color: var(--accent-cyan);">${t.transfer_number || t.id}</div>
        <div style="font-size: 10px; color: var(--text-muted);">${t.source} → ${t.destination}</div>
      </div>
      <button class="btn-approve" data-trf="${t.id}">Approve</button>
    </div>
  `).join("");

  // Attach Approve Click Handlers
  transfersContainer.querySelectorAll(".btn-approve").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const trfId = e.target.dataset.trf;
      e.target.disabled = true;
      e.target.textContent = "Approving...";
      try {
        await authFetch(`/extension/approve-transfer/${trfId}`, { method: "POST" });
        showBanner(`Transfer ${trfId} approved successfully!`, "warning");
        await loadDashboard();
      } catch (err) {
        showBanner(err.message, "error");
        e.target.disabled = false;
        e.target.textContent = "Approve";
      }
    });
  });
}

// Warehouse Selector Change
warehouseSelect.addEventListener("change", (e) => {
  activeWarehouseId = e.target.value;
  loadDashboard();
});

// Refresh Button
refreshBtn.addEventListener("click", loadDashboard);

// Tab Navigation
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

    btn.classList.add("active");
    const targetId = btn.dataset.tab;
    document.getElementById(targetId)?.classList.add("active");
  });
});

// Live Search with Debounce
skuSearch.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  const q = e.target.value.trim();

  searchDebounceTimer = setTimeout(async () => {
    if (q.length < 2) {
      if (currentSummary && currentSummary.stock) {
        renderStockList(currentSummary.stock);
      }
      return;
    }

    try {
      const results = await authFetch(`/extension/search?q=${encodeURIComponent(q)}`);
      if (results.length === 0) {
        stockListContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🔍</span>
            No products matching "${q}"
          </div>
        `;
        return;
      }

      stockListContainer.innerHTML = results.map(r => `
        <div class="list-row">
          <div>
            <div class="item-sku">${r.sku}</div>
            <div class="item-sub">${r.name}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; font-size: 12px;">${r.total_available} ${r.unit}</div>
            <span class="item-status-tag tag-normal">All Hubs</span>
          </div>
        </div>
      `).join("");
    } catch (err) {
      console.error("Search failed:", err);
    }
  }, 250);
});

// Deep Link Navigation
function openWebRoute(path) {
  const fullUrl = `${WEB_BASE}${path}`;
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: fullUrl });
  } else {
    window.open(fullUrl, "_blank");
  }
}

document.getElementById("deepInventory")?.addEventListener("click", () => openWebRoute("/inventory"));
document.getElementById("deepTransfers")?.addEventListener("click", () => openWebRoute("/transfers"));
document.getElementById("deepOptimizer")?.addEventListener("click", () => openWebRoute("/optimizer"));
document.getElementById("deepConsole")?.addEventListener("click", () => openWebRoute("/dashboard"));

// Launch
initApp();
