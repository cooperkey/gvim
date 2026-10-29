/**
 * Vim-For-Docs Background Service Worker
 * Manages Native Messaging Host connection to Neovim and relays
 * messages to active Google Docs tabs.
 */

const NATIVE_HOST_NAME = "com.vimfordocs.neovim";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "vimfordocs-neovim") return;

  console.log("[VimBackground] Google Docs tab connected. Spawning Native Neovim port...");
  let nativePort = null;
  let tabClosed = false;
  let hostClosed = false;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (err) {
    console.error("[VimBackground] Failed to connect to native messaging host:", err);
    postToTab({ type: "error", message: `Native host connection failed: ${err.message}` });
    // Close the tab port as well, otherwise the content script waits for a
    // "ready" message that can never arrive and never retries.
    try { port.disconnect(); } catch (_) {}
    return;
  }

  function postToTab(message) {
    if (tabClosed) return;
    try {
      port.postMessage(message);
    } catch (e) {
      console.warn("[VimBackground] Failed to relay message to tab:", e);
    }
  }

  function closeHost() {
    if (!nativePort) return;
    const port_ = nativePort;
    nativePort = null;
    try {
      port_.postMessage({ type: "exit" });
      port_.disconnect();
    } catch (_) {}
  }

  // Forward Neovim stdout messages to Google Docs tab
  nativePort.onMessage.addListener((msg) => {
    postToTab(msg);
  });

  // Handle native host disconnection
  nativePort.onDisconnect.addListener(() => {
    if (hostClosed) return;
    hostClosed = true;
    const err = chrome.runtime.lastError;
    const message = err ? err.message : "Native host disconnected unexpectedly";
    console.warn("[VimBackground] Native host disconnected:", message);
    postToTab({ type: "status", event: "host_disconnected", error: message });
    try { port.disconnect(); } catch (_) {}
    nativePort = null;
  });

  // Forward Google Docs tab requests to Neovim stdin
  port.onMessage.addListener((msg) => {
    if (!nativePort) return;
    try {
      nativePort.postMessage(msg);
    } catch (e) {
      console.error("[VimBackground] Failed to relay message to native host:", e);
    }
  });

  // Handle tab closing
  port.onDisconnect.addListener(() => {
    if (tabClosed) return;
    tabClosed = true;
    console.log("[VimBackground] Tab disconnected; closing native Neovim port");
    closeHost();
  });
});
