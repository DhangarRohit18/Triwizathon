const API_BASE = "http://localhost:8000/api/v1";

// Demo token for operator persona to allow standalone extension inspection
const DEMO_TOKEN = "demo_token_stockpilot";

async function fetchSummary() {
  const stockList = document.getElementById("stockList");
  const alertList = document.getElementById("alertList");
  const whName = document.getElementById("whName");
  const alertCount = document.getElementById("alertCount");

  try {
    // Attempt to login or get demo token
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "warehouse.manager@stockpilot.ai", password: "Admin123!" })
    });
    
    if (!loginRes.ok) throw new Error("Could not authenticate");
    const loginData = await loginRes.json();
    const token = loginData.access_token;

    const res = await fetch(`${API_BASE}/extension/summary`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();

    whName.textContent = data.warehouse.name;
    alertCount.textContent = `${data.active_alerts.length} Active`;
    alertCount.style.color = data.active_alerts.length > 0 ? "#f87171" : "#10b981";

    // Populate stock
    if (data.stock && data.stock.length > 0) {
      stockList.innerHTML = data.stock.map(s => `
        <div class="stock-item">
          <div>
            <div class="stock-sku">${s.sku}</div>
            <div style="font-size: 10px; color: #94a3b8;">${s.name.substring(0, 24)}...</div>
          </div>
          <div class="stock-qty ${s.is_low ? 'low' : ''}">
            ${s.available}
            ${s.is_low ? '<span style="font-size: 9px; display: block; color: #ef4444;">LOW</span>' : ''}
          </div>
        </div>
      `).join("");
    } else {
      stockList.innerHTML = `<div style="padding: 10px; text-align: center; color: #64748b;">No stock recorded</div>`;
    }

    // Populate alerts
    if (data.active_alerts && data.active_alerts.length > 0) {
      alertList.innerHTML = data.active_alerts.map(a => `
        <div class="alert-item">
          <strong>[${a.severity.toUpperCase()}]</strong> ${a.message}
        </div>
      `).join("");
    } else {
      alertList.innerHTML = `<div style="padding: 10px; text-align: center; color: #10b981; font-size: 11px;">✓ All storage conditions nominal</div>`;
    }

  } catch (err) {
    stockList.innerHTML = `<div style="padding: 10px; color: #f87171; text-align: center;">Backend offline or port 8000 unreachable.</div>`;
  }
}

document.getElementById("openConsoleBtn").addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.create({ url: "http://localhost:5173" });
  } else {
    window.open("http://localhost:5173", "_blank");
  }
});

document.getElementById("refreshBtn").addEventListener("click", fetchSummary);

// SKU Search input handler
document.getElementById("skuInput").addEventListener("input", async (e) => {
  const q = e.target.value.trim();
  if (q.length < 2) {
    fetchSummary();
    return;
  }
  try {
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "warehouse.manager@stockpilot.ai", password: "Admin123!" })
    });
    const { access_token } = await loginRes.json();
    const res = await fetch(`${API_BASE}/extension/search?q=${encodeURIComponent(q)}`, {
      headers: { "Authorization": `Bearer ${access_token}` }
    });
    const items = await res.json();
    const stockList = document.getElementById("stockList");
    if (items.length === 0) {
      stockList.innerHTML = `<div style="padding: 10px; text-align: center; color: #94a3b8;">No matching SKU found</div>`;
      return;
    }
    stockList.innerHTML = items.map(s => `
      <div class="stock-item">
        <div>
          <div class="stock-sku">${s.sku}</div>
          <div style="font-size: 10px; color: #94a3b8;">${s.name} (${s.handling})</div>
        </div>
        <div class="stock-qty">
          ${s.total_available} ${s.unit}
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error(err);
  }
});

fetchSummary();
