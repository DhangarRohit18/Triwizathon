/**
 * StockPilot AI - Scoped Page Context Script (Manifest V3)
 * 
 * Strict Privacy & Security Boundaries:
 * - Scoped strictly to internal StockPilot web console domains (localhost:5173, stockpilot.ai).
 * - Never scrapes unapproved domains, passwords, financial data, or user inputs.
 * - Non-privileged and read-only: only activates upon explicit query from the popup companion.
 * - Extracts only visible product identifiers (SKUs, batch numbers, barcodes) for operator convenience.
 */

(() => {
  // Regex patterns for standard StockPilot logistics identifiers
  const SKU_REGEX = /\b(PRD-[A-Z0-9]{2,10}-[A-Z0-9]{2,10})\b/i;
  const BATCH_REGEX = /\b(BN-[A-Z0-9]{2,10}-[0-9]{4}-[A-Z0-9]{1,6})\b/i;
  const BARCODE_REGEX = /\b(890\d{9,11})\b/;
  const TRANSFER_REGEX = /\b(TRF-[A-Z0-9-]+)\b/i;

  function extractVisibleIdentifier() {
    // 1. Check current URL search parameters or path
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const skuParam = urlParams.get("sku") || urlParams.get("product_sku");
      if (skuParam && SKU_REGEX.test(skuParam)) {
        return { type: "SKU", value: skuParam.toUpperCase(), source: "URL Parameter" };
      }
      const batchParam = urlParams.get("batch") || urlParams.get("batch_number");
      if (batchParam && BATCH_REGEX.test(batchParam)) {
        return { type: "BATCH", value: batchParam.toUpperCase(), source: "URL Parameter" };
      }
    } catch (_) {}

    // 2. Check active user selection (operator highlighted a SKU/batch)
    const selection = window.getSelection() ? window.getSelection().toString().trim() : "";
    if (selection) {
      const skuMatch = selection.match(SKU_REGEX);
      if (skuMatch) {
        return { type: "SKU", value: skuMatch[1].toUpperCase(), source: "Selected Text" };
      }
      const batchMatch = selection.match(BATCH_REGEX);
      if (batchMatch) {
        return { type: "BATCH", value: batchMatch[1].toUpperCase(), source: "Selected Text" };
      }
      const barcodeMatch = selection.match(BARCODE_REGEX);
      if (barcodeMatch) {
        return { type: "BARCODE", value: barcodeMatch[1], source: "Selected Text" };
      }
    }

    // 3. Check designated data attributes on DOM elements
    const skuElem = document.querySelector("[data-sku], [data-product-sku], [data-identifier]");
    if (skuElem) {
      const val = skuElem.getAttribute("data-sku") || skuElem.getAttribute("data-product-sku") || skuElem.getAttribute("data-identifier");
      if (val && SKU_REGEX.test(val)) {
        return { type: "SKU", value: val.toUpperCase(), source: "Page Context Element" };
      }
    }

    const batchElem = document.querySelector("[data-batch], [data-batch-number]");
    if (batchElem) {
      const bVal = batchElem.getAttribute("data-batch") || batchElem.getAttribute("data-batch-number");
      if (bVal && BATCH_REGEX.test(bVal)) {
        return { type: "BATCH", value: bVal.toUpperCase(), source: "Page Context Element" };
      }
    }

    // 4. Check prominent headings or breadcrumbs matching standard format
    const headings = document.querySelectorAll("h1, h2, h3, .product-sku-badge, .inventory-title");
    for (const h of headings) {
      const txt = h.textContent || "";
      const match = txt.match(SKU_REGEX);
      if (match) {
        return { type: "SKU", value: match[1].toUpperCase(), source: "Page Heading" };
      }
    }

    return null;
  }

  // Listen for queries from the extension popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === "EXTRACT_PAGE_CONTEXT") {
        const detected = extractVisibleIdentifier();
        sendResponse({
          success: true,
          detected: detected,
          location: window.location.pathname,
          title: document.title
        });
      }
      return true; // Keep message channel open for asynchronous response
    });
  }
})();
