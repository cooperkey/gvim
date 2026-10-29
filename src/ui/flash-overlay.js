/**
 * Flash.nvim Visual Jump Engine for Google Docs
 * Provides visual canvas dimming and instant letter-badge jumps across the document.
 */

(() => {
  const JUMP_LABELS = [
    's', 'd', 'f', 'j', 'k', 'l', 'h', 'g', 'a',
    'w', 'e', 'r', 'u', 'i', 'o', 'p', 'c', 'v', 'b', 'n', 'm',
    'x', 'z', 'q', 'y', 't'
  ];

  class FlashOverlay {
    constructor() {
      this.active = false;
      this.step = 'await_search_char'; // await_search_char | await_jump_key
      this.searchChar = null;
      this.container = null;
      this.dimLayer = null;
      this.badgeLayer = null;
      this.targets = new Map(); // keyChar -> { offset, row, col, x, y }
      this.onJumpCallback = null;
      this.boundKeyHandler = (e) => this._onKeyDown(e);
      this._justActivated = false;
    }

    _ensureElements() {
      if (!this.container || !document.body.contains(this.container)) {
        this.container = document.createElement('div');
        this.container.id = 'vim-flash-container';
        Object.assign(this.container.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: '99990',
          display: 'none'
        });

        // 1. Dark dimming layer (only shown on step 2 when matches are displayed)
        this.dimLayer = document.createElement('div');
        this.dimLayer.id = 'vim-flash-dim-layer';
        Object.assign(this.dimLayer.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(0.5px)',
          transition: 'opacity 0.12s ease',
          display: 'none'
        });
        this.container.appendChild(this.dimLayer);

        // 2. Badges layer
        this.badgeLayer = document.createElement('div');
        this.badgeLayer.id = 'vim-flash-badges';
        Object.assign(this.badgeLayer.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%'
        });
        this.container.appendChild(this.badgeLayer);

        document.body.appendChild(this.container);
      }
    }

    /**
     * Activates Flash jump mode.
     * @param {Function} onJump (target: { offset, row, col, x, y }) => void
     */
    activate(onJump) {
      if (this.active) this.deactivate();
      this._ensureElements();

      this.active = true;
      this.step = 'await_search_char';
      this.searchChar = null;
      this.targets.clear();
      this.onJumpCallback = onJump;
      this._justActivated = true;

      // Ensure dim layer is hidden initially until user types search character!
      if (this.dimLayer) this.dimLayer.style.display = 'none';
      if (this.badgeLayer) this.badgeLayer.innerHTML = '';
      this.container.style.display = 'block';

      if (window.VimUI && typeof window.VimUI.setBufferText === 'function') {
        window.VimUI.setBufferText('⚡ FLASH: type search character...');
      }

      // Attach key listeners synchronously so subsequent keystrokes are captured immediately
      window.addEventListener('keydown', this.boundKeyHandler, true);
      const iframe = document.querySelector('.docs-texteventtarget-iframe');
      if (iframe?.contentDocument) {
        iframe.contentDocument.addEventListener('keydown', this.boundKeyHandler, true);
      }

      // Release initial activation guard at end of microtask queue
      queueMicrotask(() => {
        this._justActivated = false;
      });
    }

    deactivate() {
      this.active = false;
      this.step = 'await_search_char';
      this.searchChar = null;
      this.targets.clear();
      this.onJumpCallback = null;
      this._justActivated = false;

      if (this.container) {
        this.container.style.display = 'none';
        if (this.dimLayer) this.dimLayer.style.display = 'none';
        if (this.badgeLayer) this.badgeLayer.innerHTML = '';
      }

      window.removeEventListener('keydown', this.boundKeyHandler, true);
      const iframe = document.querySelector('.docs-texteventtarget-iframe');
      if (iframe?.contentDocument) {
        iframe.contentDocument.removeEventListener('keydown', this.boundKeyHandler, true);
      }

      if (window.VimUI && typeof window.VimUI.setBufferText === 'function') {
        window.VimUI.setBufferText('');
      }
    }

    _onKeyDown(e) {
      if (!this.active) return;

      // Ignore initiating event if it happens to reach this listener
      if (this._justActivated && e.key === 's') return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === 'Escape') {
        this.deactivate();
        return;
      }

      // Stage 1: Awaiting search character
      if (this.step === 'await_search_char') {
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          this.searchChar = e.key;
          this.step = 'await_jump_key';
          // Now show dim layer and find matches!
          if (this.dimLayer) this.dimLayer.style.display = 'block';
          this._findAndDisplayBadges(e.key);
        } else {
          this.deactivate();
        }
        return;
      }

      // Stage 2: Awaiting jump badge selection
      if (this.step === 'await_jump_key') {
        const choice = e.key.toLowerCase();
        const target = this.targets.get(choice);
        if (target) {
          const cb = this.onJumpCallback;
          this.deactivate();
          if (cb) cb(target);
        } else {
          // Missed or cancelled
          this.deactivate();
        }
      }
    }

    _findAndDisplayBadges(char) {
      if (!this.badgeLayer) return;
      this.badgeLayer.innerHTML = '';
      this.targets.clear();

      const searchCharLower = char.toLowerCase();
      const isCaseSensitive = /[A-Z]/.test(char);

      const executor = window.VimExecutor;
      const nav = executor?.nav;
      const docModel = nav?.documentModel ? nav.documentModel(false) : null;
      const fullText = docModel?.text || nav?.extractDocumentText?.() || '';
      const allLines = fullText.split('\n');

      const ci = nav?.caretIndex?.() || { index: 0 };
      const currentCaretOffset = Math.max(0, ci.index || 0);

      // Current row and column from document text
      const prefix = fullText.slice(0, currentCaretOffset);
      const prefixLines = prefix.split('\n');
      const curRow = prefixLines.length - 1;
      const curCol = prefixLines[prefixLines.length - 1].length;

      // Caret reference position for proximity sorting
      const caretEl = document.querySelector('.kix-cursor-caret, .kix-cursor');
      const caretRect = caretEl ? caretEl.getBoundingClientRect() : null;
      const vpHeight = window.innerHeight;
      const vpWidth = window.innerWidth;
      const lineHeight = caretRect && caretRect.height > 10 ? caretRect.height : 21;
      const charWidth = 8.5;

      const pageEl = document.querySelector('.kix-page, .kix-page-paginated, .kix-canvas-tile-content');
      const pageRect = pageEl ? pageEl.getBoundingClientRect() : null;
      const pageLeft = (caretRect && curCol >= 0)
        ? Math.max(20, caretRect.left - curCol * charWidth)
        : (pageRect ? pageRect.left + 72 : 120);

      const caretX = caretRect ? caretRect.left : (pageLeft + curCol * charWidth);
      const caretY = caretRect ? caretRect.top : 200;

      const candidates = [];

      // ── Pure Engine Document Line Viewport Scan ─────────────────────────
      if (allLines.length > 0) {
        const linesAbove = Math.max(0, Math.floor(caretY / lineHeight) + 2);
        const linesBelow = Math.max(0, Math.floor((vpHeight - caretY) / lineHeight) + 2);
        const startRow = Math.max(0, curRow - linesAbove);
        const endRow = Math.min(allLines.length - 1, curRow + linesBelow);

        // Precompute line start offsets
        const lineStartOffsets = new Array(allLines.length);
        let runningOffset = 0;
        for (let i = 0; i < allLines.length; i++) {
          lineStartOffsets[i] = runningOffset;
          runningOffset += allLines[i].length + 1;
        }

        for (let r = startRow; r <= endRow; r++) {
          const line = allLines[r] || '';
          const lineCompare = isCaseSensitive ? line : line.toLowerCase();
          const targetChar = isCaseSensitive ? char : searchCharLower;

          let col = 0;
          while ((col = lineCompare.indexOf(targetChar, col)) !== -1) {
            const targetY = caretY + (r - curRow) * lineHeight;
            const targetX = pageLeft + col * charWidth;

            if (targetY >= 30 && targetY <= vpHeight - 35 && targetX >= 20 && targetX <= vpWidth - 40) {
              const offset = (lineStartOffsets[r] ?? 0) + col;

              candidates.push({
                x: targetX,
                y: targetY,
                offset: offset,
                row: r,
                col: col,
                dist: Math.hypot(targetX - caretX, targetY - caretY)
              });
            }
            col += 1;
          }
        }
      }

      // If no occurrences found anywhere in view
      if (candidates.length === 0) {
        if (window.VimUI && typeof window.VimUI.setBufferText === 'function') {
          window.VimUI.setBufferText(`FLASH: '${char}' not found in view`);
        }
        this.deactivate();
        return;
      }

      // Sort candidate matches by proximity to cursor (closest get easiest keys)
      candidates.sort((a, b) => a.dist - b.dist);

      let labelIdx = 0;
      for (const cand of candidates) {
        if (labelIdx >= JUMP_LABELS.length) break;

        const badgeKey = JUMP_LABELS[labelIdx++];
        this.targets.set(badgeKey, cand);

        const badge = document.createElement('div');
        badge.className = 'vim-flash-badge';
        badge.textContent = badgeKey.toUpperCase();
        Object.assign(badge.style, {
          position: 'fixed',
          left: `${Math.round(cand.x)}px`,
          top: `${Math.round(cand.y - 2)}px`,
          minWidth: '18px',
          height: '20px',
          lineHeight: '20px',
          textAlign: 'center',
          backgroundColor: '#ff007f', // Flash vibrant magenta
          color: '#ffffff',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          fontWeight: '800',
          fontSize: '13px',
          borderRadius: '3px',
          boxShadow: '0 0 12px rgba(255, 0, 127, 0.95), 0 2px 8px rgba(0,0,0,0.8)',
          zIndex: '99995',
          pointerEvents: 'none',
          border: '1.5px solid #ffffff'
        });
        this.badgeLayer.appendChild(badge);
      }

      if (window.VimUI && typeof window.VimUI.setBufferText === 'function') {
        window.VimUI.setBufferText(`FLASH: '${char}' (${labelIdx} matches) -> press badge letter to jump (Esc to cancel)`);
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.FlashOverlay = new FlashOverlay();
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FlashOverlay;
  }
})();
