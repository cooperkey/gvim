/**
 * Browser Content Script Transport for Native Messaging
 * Talks to background.js via chrome.runtime.connect({ name: "vimfordocs-neovim" })
 */

(() => {
  function uint8ToBase64(bytes) {
    const CHUNK_SIZE = 0x8000; // 32KB chunks
    let binary = '';
    const len = bytes.length;
    for (let i = 0; i < len; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function base64ToUint8(b64) {
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  }

  class NativeTransport {
    constructor() {
      this.port = null;
      this.onData = null; // (Uint8Array) => void
      this.onClose = null; // () => void
      this.onReady = null; // (hostInfo) => void
      this.connected = false;
    }

    connect() {
      return new Promise((resolve, reject) => {
        try {
          this.port = chrome.runtime.connect({ name: "vimfordocs-neovim" });
        } catch (e) {
          return reject(e);
        }

        let readyFired = false;

        this.port.onMessage.addListener((msg) => {
          if (!msg) return;

          if (msg.type === "ready") {
            this.connected = true;
            readyFired = true;
            if (this.onReady) this.onReady(msg);
            resolve(msg);
          } else if (msg.type === "msgpack" && msg.data) {
            if (this.onData) {
              const bytes = base64ToUint8(msg.data);
              this.onData(bytes);
            }
          } else if (msg.type === "error") {
            console.error("[NativeTransport] Error from host:", msg.message);
            if (!readyFired) reject(new Error(msg.message));
          } else if (msg.type === "status" && msg.event === "host_disconnected") {
            this.connected = false;
            if (this.onClose) this.onClose();
          }
        });

        this.port.onDisconnect.addListener(() => {
          this.connected = false;
          const err = chrome.runtime.lastError;
          if (!readyFired) {
            reject(new Error(err ? err.message : "Failed to connect to background Neovim service"));
          } else if (this.onClose) {
            this.onClose();
          }
        });
      });
    }

    send(bytes) {
      if (!this.port || !this.connected) {
        console.warn("[NativeTransport] Attempted to send while disconnected");
        return;
      }
      const b64 = uint8ToBase64(bytes);
      this.port.postMessage({ type: "msgpack", data: b64 });
    }

    disconnect() {
      if (this.port) {
        this.port.disconnect();
        this.port = null;
        this.connected = false;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.NativeTransport = NativeTransport;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NativeTransport;
  }
})();
