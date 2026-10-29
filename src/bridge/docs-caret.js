/**
 * Google Docs Caret & Viewport Controller
 * Synchronizes Neovim's cursor coordinates, visual selections, and viewport scrolling.
 */

(() => {
  class DocsCaretController {
    constructor(rpcClient, syncBridge, navigator) {
      this.nvim = rpcClient;
      this.sync = syncBridge;
      this.nav = navigator;

      this.cursorRow = 0;
      this.cursorCol = 0;
      this.mode = 'normal'; // normal, insert, visual, visual_line, visual_block, replace, command
      this.visualAnchor = null; // { row, col }
      this.isSyncingToDocs = false;

      // Seed initial cursor position from Docs caret if available
      try {
        const ci = this.nav?.caretIndex ? this.nav.caretIndex() : null;
        if (ci && Number.isInteger(ci.index) && ci.index >= 0 && this.sync) {
          const { row, col } = this.sync.offsetToRowCol(ci.index);
          this.cursorRow = row;
          this.cursorCol = col;
        }
      } catch (_) {}

      // Listen for custom true-buffer cursor movements from Neovim autocommands
      this.nvim.on('docs_cursor_moved', (args) => this._onCursorMoved(args));

      // Listen for yank events to sync with browser/OS clipboard
      this.nvim.on('docs_text_yanked', (args) => {
        if (Array.isArray(args) && typeof args[0] === 'string') {
          try {
            navigator.clipboard?.writeText(args[0]).catch(() => {});
          } catch (_) {}
        }
      });

      // Listen for redraw events if attached as UI
      this.nvim.on('redraw', (events) => this._onRedraw(events));
    }

    _onCursorMoved(args) {
      if (!Array.isArray(args)) return;
      const payload = Array.isArray(args[0]) ? args[0] : args;
      const [row, col, modeName] = payload;
      const prevRow = this.cursorRow;
      if (typeof row === 'number') this.cursorRow = Math.max(0, row);
      if (typeof col === 'number') this.cursorCol = Math.max(0, col);
      if (modeName) this._handleModeChange(modeName);
      // Neovim reports a cursor move per key, and each sync walks the whole
      // Docs DOM. Coalesce them into one update per frame.
      this._scheduleCaretSync();

      const jumpDist = Math.abs(this.cursorRow - prevRow);
      if (jumpDist > 5) {
        this.pendingScroll = 'center';
      } else if (!this.pendingScroll) {
        this.pendingScroll = 'visible';
      }

      if (window.VimUI && typeof window.VimUI.setPosition === 'function') {
        window.VimUI.setPosition(this.cursorRow + 1, this.cursorCol + 1);
      }
    }

    _scheduleCaretSync() {
      if (this._syncFrame) return;
      const run = () => {
        this._syncFrame = 0;
        this._syncCaretToDocs();
        const scroll = this.pendingScroll;
        this.pendingScroll = null;
        if (scroll === 'center') this.scrollToCaret('center');
        else if (scroll) this.scrollIntoViewIfNeeded();
      };
      if (typeof requestAnimationFrame === 'function') {
        this._syncFrame = requestAnimationFrame(run);
      } else {
        this._syncFrame = setTimeout(run, 16);
      }
    }

    _onRedraw(events) {
      if (!Array.isArray(events)) return;

      for (const ev of events) {
        if (!Array.isArray(ev) || ev.length === 0) continue;
        const name = ev[0];

        if (name === 'mode_change') {
          // Neovim sends ["mode_change", [mode_name, mode_idx]] or batched calls
          const args = ev[1];
          let modeName = '';
          if (Array.isArray(args)) {
            modeName = Array.isArray(args[0]) ? args[0][0] : args[0];
          } else if (typeof args === 'string') {
            modeName = args;
          }
          if (modeName) this._handleModeChange(modeName);
        } else if (name === 'cmdline_show') {
          // ["cmdline_show", [content, pos, firstc, prompt, indent, level]]
          const args = ev[1];
          if (Array.isArray(args)) {
            const [content, , firstc] = args;
            let text = firstc || '';
            if (Array.isArray(content)) {
              text += content.map(chunk => Array.isArray(chunk) ? chunk[1] : String(chunk)).join('');
            }
            if (window.VimUI && typeof window.VimUI.setCmdlineText === 'function') {
              window.VimUI.setCmdlineText(text);
            }
          }
        } else if (name === 'cmdline_hide') {
          if (window.VimUI && typeof window.VimUI.setCmdlineText === 'function') {
            window.VimUI.setCmdlineText('');
          }
        }
      }
    }

    _handleModeChange(modeName) {
      const prevMode = this.mode;
      if (!modeName) return;
      switch (modeName) {
        case 'n':
        case 'normal':
          this.mode = 'normal';
          this.visualAnchor = null;
          if (window.VisualBlockOverlay) window.VisualBlockOverlay.clear();
          break;
        case 'i':
        case 'insert':
          this.mode = 'insert';
          break;
        case 'v':
        case 'visual':
          this.mode = 'visual';
          if (!this.visualAnchor) {
            this.visualAnchor = { row: this.cursorRow, col: this.cursorCol };
          }
          break;
        case 'V':
        case 'visual_line':
          this.mode = 'visual_line';
          if (!this.visualAnchor) {
            this.visualAnchor = { row: this.cursorRow, col: this.cursorCol };
          }
          break;
        case '\x16':
        case 'visual_block':
          this.mode = 'visual_block';
          if (!this.visualAnchor) {
            this.visualAnchor = { row: this.cursorRow, col: this.cursorCol };
          }
          break;
        case 'R':
        case 'replace':
          this.mode = 'replace';
          break;
        case 'c':
        case 'cmdline':
          this.mode = 'command';
          break;
      }

      console.log(`[DocsCaret] Mode changed: ${prevMode} -> ${this.mode}`);
      if (window.VimUI) window.VimUI.setMode(this.mode);
    }

    _syncCaretToDocs() {
      if (this.sync.isApplyingToDocs) return;

      const nav = this.nav;
      if (!nav || typeof nav.setCaretIndex !== 'function') return;

      this.isSyncingToDocs = true;
      try {
        if (this.mode === 'normal' || this.mode === 'insert' || this.mode === 'replace') {
          const offset = this.sync.rowColToOffset(this.cursorRow, this.cursorCol);
          if (Number.isSafeInteger(offset) && offset >= 0) {
            nav.setCaretIndex(offset, false);
          }
        } else if (this.mode === 'visual') {
          if (!this.visualAnchor) this.visualAnchor = { row: this.cursorRow, col: this.cursorCol };
          const anchorOffset = this.sync.rowColToOffset(this.visualAnchor.row, this.visualAnchor.col);
          const cursorOffset = this.sync.rowColToOffset(this.cursorRow, this.cursorCol);
          if (Number.isSafeInteger(anchorOffset) && anchorOffset >= 0 &&
              Number.isSafeInteger(cursorOffset) && cursorOffset >= 0) {
            nav.setCaretIndex(anchorOffset, false);
            nav.setCaretIndex(cursorOffset, true);
          }
        } else if (this.mode === 'visual_line') {
          if (!this.visualAnchor) this.visualAnchor = { row: this.cursorRow, col: this.cursorCol };
          const minRow = Math.min(this.visualAnchor.row, this.cursorRow);
          const maxRow = Math.max(this.visualAnchor.row, this.cursorRow);
          const startOffset = this.sync.rowColToOffset(minRow, 0);
          const maxLine = this.sync.shadowLines[maxRow] || '';
          const endOffset = this.sync.rowColToOffset(maxRow, maxLine.length);
          if (Number.isSafeInteger(startOffset) && startOffset >= 0 &&
              Number.isSafeInteger(endOffset) && endOffset >= 0) {
            nav.setCaretIndex(startOffset, false);
            nav.setCaretIndex(endOffset, true);
          }
        } else if (this.mode === 'visual_block') {
          if (window.VisualBlockOverlay) {
            window.VisualBlockOverlay.render(
              this.visualAnchor ? this.visualAnchor.row : this.cursorRow,
              this.visualAnchor ? this.visualAnchor.col : this.cursorCol,
              this.cursorRow,
              this.cursorCol,
              this.sync
            );
          }
        }
      } finally {
        this.isSyncingToDocs = false;
      }
    }

    /**
     * Resolves the true on-screen bounding rect of the caret.
     * Validates that the rect has positive dimensions and a positive top coordinate.
     * Falls back to measuring the live DOM Range inside the Docs editor iframe if
     * the overlay caret is hidden, unrendered, or detached (0x0).
     */
    _getVisibleCaretRect() {
      try {
        const caret = document.querySelector(".kix-cursor-caret, .kix-cursor, .kix-selection-overlay");
        if (caret && typeof caret.getBoundingClientRect === 'function') {
          const cRect = caret.getBoundingClientRect();
          if (cRect && cRect.height > 0 && Number.isFinite(cRect.top) && cRect.top > 0) {
            return {
              top: cRect.top,
              bottom: cRect.bottom,
              height: cRect.height,
              left: cRect.left,
              right: cRect.right,
            };
          }
        }

        // Fallback: active DOM selection Range inside Google Docs event-target iframe
        const iframe = document.querySelector(".docs-texteventtarget-iframe");
        const win = iframe?.contentWindow;
        const sel = win?.getSelection ? win.getSelection() : null;
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const rRect = range.getBoundingClientRect();
          const ifRect = iframe.getBoundingClientRect();
          if (rRect && rRect.height > 0 && Number.isFinite(rRect.top)) {
            const top = rRect.top + ifRect.top;
            const height = rRect.height;
            return {
              top,
              bottom: top + height,
              height,
              left: rRect.left + ifRect.left,
              right: rRect.right + ifRect.left,
            };
          }
        }
      } catch (_) {}
      return null;
    }

    /**
     * Smoothly scrolls only when the caret is near the viewport boundary (scrolloff).
     * Strictly ignores zero-height or unmeasured caret positions to avoid spurious scrolling to top.
     */
    scrollIntoViewIfNeeded() {
      try {
        const cRect = this._getVisibleCaretRect();
        if (!cRect || cRect.height <= 0 || !Number.isFinite(cRect.top) || cRect.top <= 0) return;

        const container = document.querySelector(".kix-appview-editor, .docs-scrollable");
        if (!container) return;

        const pRect = container.getBoundingClientRect();
        const pad = 60; // ~3 lines buffer
        if (cRect.top < pRect.top + pad) {
          container.scrollBy({ top: cRect.top - (pRect.top + pad), behavior: 'auto' });
        } else if (cRect.bottom > pRect.bottom - pad) {
          container.scrollBy({ top: cRect.bottom - (pRect.bottom - pad), behavior: 'auto' });
        }
      } catch (_) {}
    }

    /**
     * Centers or scrolls the Google Docs viewport (e.g. for zz, zt, zb or large line jumps).
     * Strictly ignores zero-height or unmeasured caret positions to avoid spurious scrolling to top.
     */
    scrollToCaret(position = 'center') {
      try {
        const cRect = this._getVisibleCaretRect();
        if (!cRect || cRect.height <= 0 || !Number.isFinite(cRect.top) || cRect.top <= 0) return;

        const container = document.querySelector(".kix-appview-editor, .docs-scrollable");
        if (!container) return;

        const pRect = container.getBoundingClientRect();
        const targetY = position === 'top'
          ? cRect.top - pRect.top - 40
          : position === 'bottom'
            ? cRect.top - pRect.top - pRect.height + 80
            : cRect.top - pRect.top - pRect.height / 2;
        container.scrollBy({ top: targetY, behavior: 'auto' });
      } catch (_) {}
    }
  }

  if (typeof window !== 'undefined') {
    window.DocsCaretController = DocsCaretController;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DocsCaretController;
  }
})();
