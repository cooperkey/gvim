/**
 * Google Docs Keyboard Input Router
 * Intercepts keystrokes before they reach Google Docs and forwards them to Neovim.
 */

(() => {
  class DocsInputRouter {
    constructor(rpcClient, caretController) {
      this.nvim = rpcClient;
      this.caret = caretController;
      this.enabled = true;
      this.boundHandler = (e) => this._onKeyDown(e);
      this.attached = false;
      this.pendingPrefix = null; // 'leader' | 'operator' | 'prefix' | 'count'
      this.pendingCount = '';
      this.pendingPrefixTimer = null;
    }

    _setPendingPrefix(type) {
      this.pendingPrefix = type;
      if (this.pendingPrefixTimer) clearTimeout(this.pendingPrefixTimer);
      this.pendingPrefixTimer = setTimeout(() => {
        this.pendingPrefix = null;
        this.pendingCount = '';
      }, 1200);
    }

    _clearPendingPrefix() {
      this.pendingPrefix = null;
      this.pendingCount = '';
      if (this.pendingPrefixTimer) {
        clearTimeout(this.pendingPrefixTimer);
        this.pendingPrefixTimer = null;
      }
    }

    _dispatchKey(token) {
      // nvim_input queues the key in Neovim's typeahead, so multi-key commands
      // (dd, cw, gg, cs...) keep their pending operator between keystrokes.
      // feedkeys(..., "x") executes each key in its own RPC context and drops
      // that state, which silently broke every operator.
      this.nvim.notify('nvim_input', [token]);
    }

    attach() {
      if (this.attached) return;
      window.addEventListener("keydown", this.boundHandler, true);
      document.addEventListener("keydown", this.boundHandler, true);

      const attachToIframe = () => {
        const iframe = document.querySelector(".docs-texteventtarget-iframe");
        if (iframe?.contentDocument) {
          try {
            iframe.contentDocument.addEventListener("keydown", this.boundHandler, true);
          } catch (_) {}
        }
      };

      attachToIframe();
      const iframe = document.querySelector(".docs-texteventtarget-iframe");
      if (iframe) iframe.addEventListener("load", attachToIframe);

      this.attached = true;
      console.log("[DocsInput] Attached keydown listeners to Docs window, document, and iframe");
    }

    detach() {
      if (!this.attached) return;
      this._clearPendingPrefix();
      window.removeEventListener("keydown", this.boundHandler, true);
      document.removeEventListener("keydown", this.boundHandler, true);
      const iframe = document.querySelector(".docs-texteventtarget-iframe");
      if (iframe?.contentDocument) {
        try {
          iframe.contentDocument.removeEventListener("keydown", this.boundHandler, true);
        } catch (_) {}
      }
      this.attached = false;
    }

    _onKeyDown(e) {
      if (!this.enabled) return;
      if (e.__docsInputHandled) return;
      e.__docsInputHandled = true;

      // IME composition and AltGr characters are text, not commands: let Docs
      // commit them instead of feeding a half-composed key to Neovim.
      if (e.isComposing || e.key === 'Dead' || e.key === 'Process' ||
          e.getModifierState?.('AltGraph')) return;

      const currentMode = this.caret.mode;

      // In Insert mode: let normal characters flow directly into Google Docs
      if (currentMode === 'insert') {
        if (e.key === 'Escape' || (e.ctrlKey && (e.key === '[' || e.key === 'c'))) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Type the text into Neovim only after Docs has published it, then
          // leave insert mode. Sending <Esc> first would run the buffer ops on
          // stale text while the resync is still in flight.
          const sync = this.caret && this.caret.sync;
          if (sync && typeof sync.resyncFromDocs === 'function') {
            Promise.resolve(sync.resyncFromDocs())
              .catch(() => {})
              .then(() => this._dispatchKey('<Esc>'));
          } else {
            this._dispatchKey('<Esc>');
          }
          return;
        }
        // Let Google Docs handle typing natively with 0ms latency.
        return;
      }

      // Clear search highlights on Escape in normal/visual mode
      if (e.key === 'Escape') {
        this._clearPendingPrefix();
        if (window.SearchHighlightOverlay && typeof window.SearchHighlightOverlay.clear === 'function') {
          window.SearchHighlightOverlay.clear();
        }
        if (window.FlashOverlay && window.FlashOverlay.active) {
          window.FlashOverlay.deactivate();
        }
        if (currentMode === 'visual' && window.VimAdapter && typeof window.VimAdapter.left === 'function') {
          window.VimAdapter.left({});
        }
      }

      // Flash Jump activation ONLY on standalone 's' in normal or visual mode without any pending prefix
      const isStandaloneS = (currentMode === 'normal' || currentMode === 'visual') &&
        e.key === 's' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
        !this.pendingPrefix;

      if (isStandaloneS) {
        if (window.FlashOverlay) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          window.FlashOverlay.activate((target) => {
            if (this.caret && this.caret.nav) {
              if (typeof target.offset === 'number') {
                this.caret.nav.setCaretIndex(target.offset, false);
              }
              if (typeof target.row === 'number' && typeof target.col === 'number') {
                this.caret.cursorRow = target.row;
                this.caret.cursorCol = target.col;
                this.nvim.notify('nvim_win_set_cursor', [0, [target.row + 1, target.col]]);
                if (window.VimUI && typeof window.VimUI.setPosition === 'function') {
                  window.VimUI.setPosition(target.row + 1, target.col + 1);
                }
              }
              if (typeof this.caret.scrollIntoViewIfNeeded === 'function') {
                this.caret.scrollIntoViewIfNeeded();
              } else {
                this.caret.scrollToCaret('center');
              }
            }
          });
          return;
        }
      }

      // In Normal, Visual, Replace, Command modes: intercept and send to Neovim
      const translated = this.translateKey(e);
      if (!translated) return;

      // Allow native browser shortcuts to pass through (e.g. reload, devtools, zoom)
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        if (['r', 'R', 'l', 'w', 'q', 't'].includes(e.key.toLowerCase())) return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const rawKey = e.key;
      const isPrintable = rawKey.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
      const isShiftOnly = e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;

      // Direct native caret motion dispatch for 0ms latency in Google Docs
      const adapter = window.VimAdapter;
      const isVisual = currentMode === 'visual';
      const noOperatorPending = this.pendingPrefix !== 'operator' && this.pendingPrefix !== 'leader';

      if (adapter && noOperatorPending && (currentMode === 'normal' || currentMode === 'visual')) {
        const count = parseInt(this.pendingCount, 10) || 1;

        if (this.pendingPrefix === 'prefix') {
          if (rawKey === 'g') {
            adapter.ctrlHome?.({ shift: isVisual });
          } else if (rawKey === 'j') {
            for (let i = 0; i < count; i++) adapter.down?.({ shift: isVisual });
          } else if (rawKey === 'k') {
            for (let i = 0; i < count; i++) adapter.up?.({ shift: isVisual });
          }
        } else if (this.pendingPrefix !== 'count' || (rawKey !== '0' && !/^[1-9]$/.test(rawKey))) {
          if (rawKey === 'h' || rawKey === 'ArrowLeft') {
            for (let i = 0; i < count; i++) adapter.left?.({ shift: isVisual });
          } else if (rawKey === 'l' || rawKey === 'ArrowRight') {
            for (let i = 0; i < count; i++) adapter.right?.({ shift: isVisual });
          } else if (rawKey === 'j' || rawKey === 'ArrowDown') {
            for (let i = 0; i < count; i++) adapter.down?.({ shift: isVisual });
          } else if (rawKey === 'k' || rawKey === 'ArrowUp') {
            for (let i = 0; i < count; i++) adapter.up?.({ shift: isVisual });
          } else if ((rawKey === '0' && !this.pendingCount) || rawKey === 'Home') {
            adapter.home?.({ shift: isVisual });
          } else if (rawKey === '$' || rawKey === 'End') {
            adapter.end?.({ shift: isVisual });
          } else if (rawKey === 'w' && isPrintable) {
            for (let i = 0; i < count; i++) adapter.ctrlRight?.({ shift: isVisual });
          } else if (rawKey === 'b' && isPrintable) {
            for (let i = 0; i < count; i++) adapter.ctrlLeft?.({ shift: isVisual });
          } else if (rawKey === 'G' && (isPrintable || isShiftOnly)) {
            adapter.ctrlEnd?.({ shift: isVisual });
          } else if (rawKey === 'PageDown' || (e.ctrlKey && rawKey.toLowerCase() === 'f')) {
            adapter.pageDown?.();
          } else if (rawKey === 'PageUp' || (e.ctrlKey && rawKey.toLowerCase() === 'b')) {
            adapter.pageUp?.();
          }
        }
      }

      // Update pending prefix & count state
      if (rawKey === ' ' || rawKey === 'Space') {
        if (currentMode === 'normal' || currentMode === 'visual') {
          this._setPendingPrefix('leader');
        }
      } else if (isPrintable && ['c', 'd', 'y'].includes(rawKey)) {
        this._setPendingPrefix('operator');
      } else if (isPrintable && ['g', 'z', 'f', 't', 'F', 'T', 'r', '"', "'"].includes(rawKey)) {
        this._setPendingPrefix('prefix');
      } else if (isPrintable && /^[1-9]$/.test(rawKey)) {
        this.pendingCount += rawKey;
        this._setPendingPrefix('count');
      } else if (isPrintable && rawKey === '0' && this.pendingPrefix === 'count') {
        this.pendingCount += rawKey;
        this._setPendingPrefix('count');
      } else if (isPrintable && (rawKey === 'i' || rawKey === 'a') && (this.pendingPrefix === 'operator' || currentMode === 'visual')) {
        this._setPendingPrefix('textobject');
      } else {
        this._clearPendingPrefix();
      }

      this._dispatchKey(translated);
    }

    /**
     * Translates a DOM KeyboardEvent into Neovim's key notation (<CR>, <Esc>, <C-v>, <lt>, etc.)
     */
    translateKey(e) {
      const key = e.key;

      // Special key translations
      const specialMap = {
        'Escape': '<Esc>',
        'Enter': '<CR>',
        'Backspace': '<BS>',
        'Tab': '<Tab>',
        'Delete': '<Del>',
        'ArrowLeft': '<Left>',
        'ArrowRight': '<Right>',
        'ArrowUp': '<Up>',
        'ArrowDown': '<Down>',
        'Home': '<Home>',
        'End': '<End>',
        'PageUp': '<PageUp>',
        'PageDown': '<PageDown>',
        'Insert': '<Insert>',
      };

      if (specialMap[key]) {
        let name = specialMap[key].slice(1, -1);
        let prefix = '';
        if (e.shiftKey && name !== 'Tab') prefix += 'S-';
        if (e.ctrlKey) prefix += 'C-';
        if (e.altKey) prefix += 'A-';
        if (e.metaKey) prefix += 'M-';
        return prefix ? `<${prefix}${name}>` : specialMap[key];
      }

      // Function keys F1-F12
      if (/^F([1-9]|1[0-2])$/.test(key)) {
        let prefix = '';
        if (e.ctrlKey) prefix += 'C-';
        if (e.altKey) prefix += 'A-';
        if (e.shiftKey) prefix += 'S-';
        return `<${prefix}${key}>`;
      }

      // Space (<Space> represents leader key in user's nvim config)
      if (key === ' ' || key === 'Space') {
        if (e.ctrlKey) return '<C-Space>';
        return '<Space>';
      }

      // Single printable characters
      if (key.length === 1) {
        // Escaped '<' is '<lt>' in Neovim
        let ch = key === '<' ? '<lt>' : key;

        if (e.ctrlKey && !e.altKey && !e.metaKey) {
          return `<C-${key.toLowerCase()}>`;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
          return `<A-${key}>`;
        }
        if (e.metaKey && !e.ctrlKey && !e.altKey) {
          return `<M-${key}>`;
        }

        return ch;
      }

      return null;
    }
  }

  if (typeof window !== 'undefined') {
    window.DocsInputRouter = DocsInputRouter;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DocsInputRouter;
  }
})();
