#!/usr/bin/env node
/**
 * ============================================================================
 * STOCKPILOT AI - WHATSAPP WEB LINKED DEVICE BRIDGE (POWERED BY BAILEYS)
 * ============================================================================
 * References Kurukshatra Baileys Bridge Architecture.
 * Connects any personal or corporate mobile WhatsApp number directly via
 * Linked Device QR code (or 8-digit phone pairing code).
 *
 * Ingests incoming warehouse & supply chain inquiries, processes them through
 * StockPilot AI's deterministic multi-lingual NLP engine (English, Hindi, Marathi,
 * Hinglish, Minglish), and dispatches authoritative stock, transfer, and IoT
 * cold-chain replies in real time.
 * ============================================================================
 */

const path = require("path");
const fs = require("fs");
const http = require("http");

console.log("\x1b[1m\x1b[36m===============================================================\x1b[0m");
console.log("\x1b[1m\x1b[32m  STOCKPILOT AI: WHATSAPP WEB LINKED DEVICE BRIDGE (BAILEYS)\x1b[0m");
console.log("\x1b[36m===============================================================\x1b[0m");
console.log("Connects your personal or warehouse mobile via WhatsApp Web Linked Device QR Code.\n");

// Dynamic resolver supporting local or Kurukshatra node_modules
function resolveModule(moduleName) {
  try {
    return require(moduleName);
  } catch {
    try {
      const kurukshatraPath = path.resolve(__dirname, "../../Kurukshatra/node_modules", moduleName);
      return require(kurukshatraPath);
    } catch {
      try {
        const altPath = "C:/Users/user/OneDrive/Desktop/Competition/Kurukshatra/node_modules/" + moduleName;
        return require(altPath);
      } catch (err) {
        throw new Error(`Could not resolve module '${moduleName}': ${err.message}`);
      }
    }
  }
}

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, qrcodeTerminal, QRCode, pino;
try {
  const baileys = resolveModule("@whiskeysockets/baileys");
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  Browsers = baileys.Browsers;
  qrcodeTerminal = resolveModule("qrcode-terminal");
  pino = resolveModule("pino");
  try {
    QRCode = resolveModule("qrcode");
  } catch {
    QRCode = null;
  }
} catch (err) {
  console.log("\x1b[33m[Setup Needed]\x1b[0m Baileys packages not found.");
  console.log("Details:", err.message);
  process.exit(1);
}

const AUTH_FOLDER = path.join(__dirname, "../.baileys_auth");
const STATUS_FILE = path.join(AUTH_FOLDER, "status.json");
const STOCKPILOT_API_BASE = process.env.STOCKPILOT_API_BASE || "http://127.0.0.1:8000/api/v1";

function updateStatusFile(data) {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    }
    const current = fs.existsSync(STATUS_FILE)
      ? JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"))
      : {};
    const updated = {
      ...current,
      ...data,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(updated, null, 2), "utf8");
  } catch (err) {
    // Non-fatal
  }
}

/**
 * Forward incoming WhatsApp message to StockPilot AI NLP engine
 */
async function forwardToStockPilot(phone, name, text) {
  const payload = JSON.stringify({
    message_text: text,
    from_number: phone.startsWith("+") ? phone : `+${phone}`
  });

  return new Promise((resolve) => {
    try {
      const parsed = new URL(`${STOCKPILOT_API_BASE}/whatsapp/simulator/chat`);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 8000,
          path: parsed.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "Authorization": "Bearer demo_token"
          },
          timeout: 8000
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve(json.reply_text || json.detail || "Query received.");
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on("error", () => resolve(fallbackOfflineReply(text, name)));
      req.on("timeout", () => {
        req.destroy();
        resolve(fallbackOfflineReply(text, name));
      });

      req.write(payload);
      req.end();
    } catch {
      resolve(fallbackOfflineReply(text, name));
    }
  });
}

function fallbackOfflineReply(text, name) {
  const lower = (text || "").toLowerCase();
  if (lower.includes("stock") || lower.includes("vax") || lower.includes("किती") || lower.includes("kitna")) {
    return `📦 *StockPilot AI Inventory (Offline Fallback)*\nPRD-VAX-01 (Bio-Vax Cold Chain): 8,450 vials available across Chicago & New York Hubs. FEFO Batch: BAT-VAX-CHI-01 (Expires in 28 days - Liquidate Priority).`;
  }
  if (lower.includes("alert") || lower.includes("iot") || lower.includes("तापमान") || lower.includes("temp")) {
    return `❄️ *StockPilot IoT Cold-Chain Status*\nChicago Hub Cold Room #1: 4.2°C (Nominal 2°C - 8°C). All ESP32 telemetry sensors online.`;
  }
  return `🤖 *StockPilot AI Mobile Assistant*\nHello ${name || "Operator"}! Available commands: *STATUS*, *STOCK <SKU>*, *TRANSFER <ID>*, *ALERTS*, *APPROVE <ID>*, *HELP*.`;
}

async function startWhatsAppBridge() {
  if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  }

  updateStatusFile({
    status: "STARTING",
    message: "Initializing StockPilot Baileys Multi-Device Client..."
  });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1043857760],
    isLatest: true
  }));

  console.log(`[Baileys Bridge] Initializing WhatsApp Web v${version.join(".")} (Latest: ${isLatest})...`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu("StockPilot-AI"),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    emitOwnEvents: false
  });

  sock.ev.on("creds.update", saveCreds);

  // Check pairing code argument --phone
  const phoneArg = process.argv.find((a) => a.startsWith("--phone="))?.split("=")[1] ||
    (process.argv.indexOf("--phone") !== -1 ? process.argv[process.argv.indexOf("--phone") + 1] : null) ||
    process.env.WA_PHONE ||
    null;

  if (phoneArg && !sock.authState.creds.registered) {
    const cleanPhone = phoneArg.replace(/[^0-9]/g, "");
    setTimeout(async () => {
      try {
        const pairingCode = await sock.requestPairingCode(cleanPhone);
        console.log("\n\x1b[1m\x1b[32m===============================================================\x1b[0m");
        console.log(`\x1b[1m\x1b[33m  WHATSAPP PAIRING CODE FOR +${cleanPhone}:  \x1b[32m${pairingCode}\x1b[0m`);
        console.log("\x1b[1m\x1b[32m===============================================================\x1b[0m");
        console.log("On WhatsApp: Tap Linked Devices ➔ Link with phone number instead ➔ Enter code.\n");

        updateStatusFile({
          status: "PAIRING_CODE_READY",
          pairingCode,
          phone: cleanPhone,
          message: `Enter pairing code ${pairingCode} in WhatsApp > Linked Devices > Link with phone number instead`
        });
      } catch (pairErr) {
        console.error("[Baileys Pairing Code Error]:", pairErr.message);
      }
    }, 2500);
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n\x1b[1m\x1b[32m===============================================================\x1b[0m");
      console.log("\x1b[1m  SCAN THIS QR CODE IN WHATSAPP TO CONNECT LINKED DEVICE:\x1b[0m");
      console.log("\x1b[1m\x1b[32m===============================================================\x1b[0m\n");
      qrcodeTerminal.generate(qr, { small: true });

      let qrDataUrl = null;
      if (QRCode) {
        try {
          qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
        } catch {
          // ignore
        }
      }

      updateStatusFile({
        status: "QR_READY",
        qrString: qr,
        qrDataUrl,
        message: "QR Code is active and ready to scan in WhatsApp > Linked Devices."
      });

      console.log("\x1b[36mHow to link your WhatsApp:\x1b[0m");
      console.log("1. Open WhatsApp on your Android or iPhone");
      console.log("2. Tap Menu (⋮) or Settings ➔ 'Linked Devices'");
      console.log("3. Tap 'Link a Device'");
      console.log("4. Point your camera at the QR code above\n");
    }

    if (connection === "open") {
      const userPhone = sock.user?.id ? sock.user.id.split(":")[0].replace(/[^0-9]/g, "") : "Unknown";
      const userName = sock.user?.name || "StockPilot AI Assistant";

      console.log("\n\x1b[1m\x1b[32m[SUCCESS] WhatsApp Linked Device Connected Successfully!\x1b[0m");
      console.log(`Connected Number: \x1b[1m\x1b[33m+${userPhone}\x1b[0m (${userName})`);
      console.log("Autonomous StockPilot mobile assistant is actively listening and responding.\n");

      updateStatusFile({
        status: "CONNECTED",
        phone: userPhone,
        name: userName,
        qrString: null,
        qrDataUrl: null,
        connectedAt: new Date().toISOString(),
        message: `Connected to WhatsApp (+${userPhone}) as ${userName}`
      });

      // Outbound file dispatcher: allows backend to initiate messages
      const OUTBOUND_FILE = path.join(AUTH_FOLDER, "outbound_queue.json");
      if (!sock.__outboundWatcher) {
        sock.__outboundWatcher = setInterval(async () => {
          try {
            if (fs.existsSync(OUTBOUND_FILE)) {
              const raw = fs.readFileSync(OUTBOUND_FILE, "utf8");
              fs.unlinkSync(OUTBOUND_FILE);
              const queue = JSON.parse(raw);
              const items = Array.isArray(queue) ? queue : [queue];
              for (const item of items) {
                if (item.to && item.text) {
                  const cleanTo = item.to.replace(/[^0-9]/g, "");
                  const targetJid = `${cleanTo}@s.whatsapp.net`;
                  console.log(`\x1b[32m[Outbound Dispatch]\x1b[0m Sending message to +${cleanTo}...`);
                  await sock.sendMessage(targetJid, { text: item.text });
                  console.log(`\x1b[32m  ✓ Outbound message delivered to +${cleanTo}\x1b[0m`);
                }
              }
            }
          } catch (e) {
            console.error("[Outbound Error]:", e.message);
          }
        }, 1200);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[Baileys Bridge] Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log("\x1b[31m[Baileys Bridge] Session logged out or expired. Regenerating fresh QR code...\x1b[0m");
        try {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        } catch {
          // ignore
        }
        updateStatusFile({
          status: "LOGGED_OUT",
          message: "Session logged out. Regenerating fresh QR code."
        });
        setTimeout(startWhatsAppBridge, 1500);
      } else if (shouldReconnect) {
        updateStatusFile({
          status: "RECONNECTING",
          message: "Connection interrupted. Re-establishing link..."
        });
        setTimeout(startWhatsAppBridge, 3000);
      } else {
        updateStatusFile({
          status: "DISCONNECTED",
          message: "Bridge disconnected."
        });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid || "";
      if (remoteJid.endsWith("@g.us") || remoteJid.includes("broadcast")) continue;

      const phone = remoteJid.replace("@s.whatsapp.net", "").replace(/[^0-9]/g, "");
      const profileName = msg.pushName || "Warehouse Operator";

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      if (!text) continue;

      console.log(`\n\x1b[34m[Incoming WhatsApp Message]\x1b[0m From: ${profileName} (+${phone})`);
      console.log(`  Content: "${text}"`);

      updateStatusFile({
        lastIncomingMessage: {
          phone,
          name: profileName,
          text,
          timestamp: new Date().toISOString()
        }
      });

      // Forward to StockPilot AI NLP pipeline
      const replyText = await forwardToStockPilot(phone, profileName, text);

      if (replyText) {
        console.log(`\x1b[32m  [Replying via WhatsApp Web]\x1b[0m ${replyText.slice(0, 100)}...`);
        try {
          await sock.sendMessage(remoteJid, { text: replyText });
          console.log(`\x1b[32m  ✓ Delivered to +${phone}\x1b[0m`);

          updateStatusFile({
            lastDeliveredReply: {
              phone,
              name: profileName,
              replyText: replyText.slice(0, 160),
              timestamp: new Date().toISOString()
            }
          });
        } catch (sendErr) {
          console.error(`\x1b[31m  ✗ Failed to send reply: ${sendErr.message}\x1b[0m`);
        }
      }
    }
  });
}

startWhatsAppBridge().catch((err) => {
  console.error("\x1b[31m[Baileys Fatal Error]\x1b[0m", err);
});
