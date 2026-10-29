/**
 * Neovim Msgpack-RPC Client
 * Operates on top of an abstract transport (Native Messaging port or Web Worker).
 */

(() => {
  const Msgpack = (typeof window !== 'undefined' ? window.Msgpack : null) || require('./msgpack.js');

  class NvimRpcClient {
    constructor(transport) {
      this.transport = transport;
      this.nextMsgId = 1;
      this.pendingRequests = new Map(); // msgid -> { resolve, reject, timer }
      this.notificationHandlers = new Map(); // method -> Set<handler>
      this.inBuffer = new Uint8Array(0);
      this.closed = false;

      this.transport.onData = (chunk) => this._onRawData(chunk);
      this.transport.onClose = () => this._onTransportClose();
    }

    /**
     * Sends an RPC request to Neovim and awaits the result.
     * @param {string} method e.g. "nvim_input", "nvim_buf_get_lines"
     * @param {any[]} params
     * @param {number} timeoutMs
     * @returns {Promise<any>}
     */
    request(method, params = [], timeoutMs = 15000) {
      if (this.closed || this.transport.connected === false) {
        return Promise.reject(new Error(`Neovim is not connected; ${method} was not sent`));
      }
      const msgid = this.nextMsgId++;
      const payload = [0, msgid, method, params];
      const bytes = Msgpack.encode(payload);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingRequests.has(msgid)) {
            this.pendingRequests.delete(msgid);
            reject(new Error(`Neovim RPC request ${msgid} (${method}) timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        this.pendingRequests.set(msgid, { resolve, reject, timer, method });
        try {
          this.transport.send(bytes);
        } catch (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(msgid);
          reject(err);
        }
      });
    }

    /**
     * Sends an RPC notification without expecting a response.
     * @param {string} method
     * @param {any[]} params
     */
    notify(method, params = []) {
      if (this.closed || this.transport.connected === false) return;
      const payload = [2, method, params];
      const bytes = Msgpack.encode(payload);
      try {
        this.transport.send(bytes);
      } catch (err) {
        console.warn('[NvimRpc] Failed to send notification', method, err);
      }
    }

    /**
     * Registers a listener for an incoming RPC notification (e.g. "redraw", "nvim_buf_lines_event").
     */
    on(method, handler) {
      if (!this.notificationHandlers.has(method)) {
        this.notificationHandlers.set(method, new Set());
      }
      this.notificationHandlers.get(method).add(handler);
    }

    off(method, handler) {
      if (this.notificationHandlers.has(method)) {
        this.notificationHandlers.get(method).delete(handler);
      }
    }

    _onRawData(chunk) {
      // Append incoming chunk to inBuffer
      if (this.inBuffer.length === 0) {
        this.inBuffer = chunk;
      } else {
        const combined = new Uint8Array(this.inBuffer.length + chunk.length);
        combined.set(this.inBuffer, 0);
        combined.set(chunk, this.inBuffer.length);
        this.inBuffer = combined;
      }

      // Decode all complete frames
      try {
        const { messages, consumed } = Msgpack.decodeMultiple(this.inBuffer);
        if (consumed > 0) {
          this.inBuffer = this.inBuffer.subarray(consumed);
        }
        for (const msg of messages) {
          this._handleMessage(msg);
        }
      } catch (e) {
        // A corrupt frame cannot be resynchronised: keeping the bytes would
        // make every later chunk fail the same way. Drop them and say so once.
        console.error('[NvimRpc] Message decode error; dropping buffered bytes:', e);
        this.inBuffer = new Uint8Array(0);
      }
    }

    _handleMessage(msg) {
      if (!Array.isArray(msg) || msg.length < 3) {
        console.warn('[NvimRpc] Malformed message received:', msg);
        return;
      }
      const type = msg[0];

      if (type === 1) {
        // Response: [1, msgid, error, result]
        const [, msgid, error, result] = msg;
        const pending = this.pendingRequests.get(msgid);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msgid);
          if (error) {
            pending.reject(new Error(Array.isArray(error) ? error[1] : String(error)));
          } else {
            pending.resolve(result);
          }
        }
      } else if (type === 2) {
        // Notification: [2, method, params]
        const [, method, params] = msg;
        const handlers = this.notificationHandlers.get(method);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(params);
            } catch (e) {
              console.error(`[NvimRpc] Notification handler error for ${method}:`, e);
            }
          }
        }
      }
    }

    _onTransportClose() {
      if (this.closed) return;
      this.closed = true;
      this.inBuffer = new Uint8Array(0);
      for (const [msgid, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Neovim transport closed while awaiting ${pending.method} (${msgid})`));
      }
      this.pendingRequests.clear();
      const handlers = this.notificationHandlers.get('close');
      if (handlers) {
        for (const handler of handlers) handler();
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.NvimRpcClient = NvimRpcClient;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NvimRpcClient;
  }
})();
