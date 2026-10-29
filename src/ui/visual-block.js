/**
 * Authentic Visual Block (<C-v>) Overlay for Google Docs Canvas
 * Renders terminal-style rectangular block selection highlights directly over Google Docs pages.
 */

(() => {
  class VisualBlockOverlay {
    constructor() {
      this.container = null;
      this._ensureContainer();
    }

    _ensureContainer() {
      if (this.container && this.container.isConnected) return;
      this.container = document.createElement('div');
      this.container.id = 'vim-visual-block-container';
      this.container.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1000;
      `;
      const editor = document.querySelector('.kix-appview-editor') || document.body;
      editor.appendChild(this.container);
    }

    render(anchorRow, anchorCol, curRow, curCol, syncBridge) {
      this._ensureContainer();
      this.clear();

      const minRow = Math.min(anchorRow, curRow);
      const maxRow = Math.max(anchorRow, curRow);
      const minCol = Math.min(anchorCol, curCol);
      const maxCol = Math.max(anchorCol, curCol);

      const nav = syncBridge.nav;
      if (!nav) return;

      const editorRect = (document.querySelector('.kix-appview-editor') || document.body).getBoundingClientRect();

      for (let r = minRow; r <= maxRow; r++) {
        const line = syncBridge.shadowLines[r] || '';
        const c1 = Math.min(minCol, line.length);
        const c2 = Math.min(maxCol + 1, line.length);

        if (c2 <= c1 && line.length === 0) continue;

        const startOff = syncBridge.rowColToOffset(r, c1);
        const endOff = syncBridge.rowColToOffset(r, Math.max(c1 + 1, c2));

        // Use Selection.getRangeAt(0) bounding rect to find character coordinates
        const rect = this._getRangeRect(startOff, endOff, nav);
        if (rect && rect.width > 0 && rect.height > 0) {
          const blockEl = document.createElement('div');
          blockEl.className = 'vim-visual-block-slice';
          blockEl.style.cssText = `
            position: absolute;
            left: ${rect.left - editorRect.left + (window.scrollX || 0)}px;
            top: ${rect.top - editorRect.top + (window.scrollY || 0)}px;
            width: ${Math.max(rect.width, 8)}px;
            height: ${rect.height}px;
            background: rgba(70, 130, 240, 0.35);
            border: 1px solid rgba(120, 180, 255, 0.85);
            box-sizing: border-box;
            border-radius: 1px;
            pointer-events: none;
          `;
          this.container.appendChild(blockEl);
        }
      }
    }

    _getRangeRect(startOff, endOff, nav) {
      try {
        const { sel } = nav.getSelAndRange();
        if (!sel) return null;
        const prevAnchor = sel.anchorNode, prevAOff = sel.anchorOffset;
        const prevFocus = sel.focusNode, prevFOff = sel.focusOffset;

        nav.setCaretIndex(startOff, false);
        nav.setCaretIndex(endOff, true);

        const currentSel = nav.getSelAndRange().sel;
        if (!currentSel || currentSel.rangeCount === 0) return null;
        const r = currentSel.getRangeAt(0).getBoundingClientRect();

        // Restore selection
        sel.collapse(prevAnchor, prevAOff);
        sel.extend(prevFocus, prevFOff);

        return r;
      } catch (_) {
        return null;
      }
    }

    clear() {
      if (this.container) {
        this.container.innerHTML = '';
      }
    }
  }

  const instance = new VisualBlockOverlay();
  if (typeof window !== 'undefined') {
    window.VisualBlockOverlay = instance;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
})();
