(function(){
  class VimUIV2Internal {
    constructor() {
      this.theme = 'vim';
      this.modeText = 'normal';
      this.bufferText = '';
      this.cmdlineText = '';
      this.backendText = 'Pure Vim';
      this.lineNum = 1;
      this.colNum = 1;
      this.replaceMode = false;
      this.tempNormal = false;
      this.enabled = true;
      this.ind = null;

      // Default to user's active Ghostty theme (wons)
      this.ghosttyTheme = {
        name: 'wons',
        background: '#000000',
        foreground: '#f5f5f5',
        border: '#2f2f2f',
        palette: { '0': '#3f3f3f', '8': '#2f2f2f' }
      };

      this.ensureIndicator();
      this.applyTheme();
    }

    ensureIndicator() {
      if (this.ind && document.body && document.body.contains(this.ind)) {
        if (!this.ind.querySelector('.vim-status-pos')) {
          this.applyTheme();
        }
        return;
      }
      const existing = typeof document !== 'undefined' ? document.getElementById('vim-for-docs-indicator') : null;
      if (existing) {
        this.ind = existing;
        if (!this.ind.querySelector('.vim-status-pos')) {
          this.applyTheme();
        }
        return;
      }
      if (typeof document === 'undefined' || !document.body) return;
      this.ind = document.createElement('div');
      this.ind.id = 'vim-for-docs-indicator';
      this.ind.setAttribute('role', 'status');
      this.ind.setAttribute('aria-live', 'polite');
      document.body.appendChild(this.ind);
      this.applyTheme();
    }

    setGhosttyTheme(t) {
      if (t && typeof t === 'object') {
        this.ghosttyTheme = { ...this.ghosttyTheme, ...t };
        this.applyTheme();
        this.render();
      }
    }

    setTheme(t) {
      this.theme = t || 'vim';
      this.applyTheme();
      this.render();
    }

    setMode(m) {
      this.modeText = m || 'normal';
      this.render();
      this.updateCursorStyle();
    }

    setBackend(b) {
      this.backendText = b || '';
      this.render();
    }

    setPosition(line, col) {
      this.lineNum = Math.max(1, line || 1);
      this.colNum = Math.max(1, col || 1);
      this.render();
    }

    setCmdlineText(s) {
      this.cmdlineText = s || '';
      this.render();
    }

    setReplaceMode(v) {
      this.replaceMode = !!v;
      this.render();
    }

    setTempNormal(v) {
      this.tempNormal = !!v;
      this.render();
    }

    setBufferText(s) {
      const next = s || '';
      if (next === this.bufferText) return;
      this.bufferText = next;
      this.render();
    }

    setEnabled(value) {
      this.enabled = !!value;
      if (this.ind) {
        this.ind.style.display = this.enabled ? 'flex' : 'none';
      }
      this.updateCursorStyle();
    }

    showStartupError(message) {
      this.setEnabled(false);
      this.setMode('disabled');
      this.setBufferText(message);
      this.ind.setAttribute('role', 'alert');
      this.ind.setAttribute('aria-live', 'assertive');
      this.ind.style.display = 'flex';
    }

    applyTheme() {
      if (!this.ind) return;
      const hidden = this.ind.style.display === 'none';
      const bg = this.ghosttyTheme.background || '#000000';
      const fg = this.ghosttyTheme.foreground || '#f5f5f5';
      const border = this.ghosttyTheme.border || '#2f2f2f';

      Object.assign(this.ind.style, {
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        height: '24px',
        backgroundColor: bg,
        color: fg,
        padding: '0 12px',
        fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        fontSize: '12px',
        lineHeight: '24px',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: '99999',
        display: 'flex',
        borderTop: `1px solid ${border}`,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.4)',
        boxSizing: 'border-box',
        userSelect: 'none'
      });

      this.ind.innerHTML = `
        <div class="vim-status-left" style="display:flex; align-items:center; gap:8px; height:100%;">
          <div class="vim-status-mode"></div>
          <div class="vim-status-file" style="color:#888; font-size:11px;">Google Docs</div>
        </div>
        <div class="vim-status-center" style="flex:1; margin:0 16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${fg};"></div>
        <div class="vim-status-right" style="display:flex; align-items:center; gap:10px; font-size:11px; color:#888;">
          <div class="vim-status-pos" style="color:${fg}; font-weight:500;"></div>
          <div class="vim-status-theme" style="padding:0 4px; border-radius:2px; background:#181818; color:#aaa;"></div>
          <div class="vim-status-backend" style="color:#666;"></div>
        </div>
      `;

      if (hidden) this.ind.style.display = 'none';
    }

    render() {
      this.ensureIndicator();
      if (!this.ind) return;

      const mElem = this.ind.querySelector('.vim-status-mode');
      const cElem = this.ind.querySelector('.vim-status-center');
      const posElem = this.ind.querySelector('.vim-status-pos');
      const themeElem = this.ind.querySelector('.vim-status-theme');
      const bElem = this.ind.querySelector('.vim-status-backend');

      const isReplace = this.replaceMode || this.modeText === 'replace';
      let pillText = 'N';
      let pillBg = '#f5f5f5';
      let pillFg = '#000000';

      const normMode = (this.modeText || '').toLowerCase();
      if (normMode === 'insert' || normMode === 'i') {
        pillText = 'I';
        pillBg = '#10b981';
        pillFg = '#000000';
      } else if (normMode === 'visual_line' || normMode === 'visualline') {
        pillText = 'V-L';
        pillBg = '#f59e0b';
        pillFg = '#000000';
      } else if (normMode === 'visual_block') {
        pillText = '^V';
        pillBg = '#ea580c';
        pillFg = '#ffffff';
      } else if (normMode.startsWith('visual') || normMode === 'v') {
        pillText = 'V';
        pillBg = '#f59e0b';
        pillFg = '#000000';
      } else if (isReplace || normMode === 'r') {
        pillText = 'R';
        pillBg = '#ef4444';
        pillFg = '#ffffff';
      } else if (normMode === 'command' || normMode === 'c') {
        pillText = ':';
        pillBg = '#8b5cf6';
        pillFg = '#ffffff';
      } else {
        pillText = 'N';
        pillBg = '#f5f5f5';
        pillFg = '#000000';
      }

      if (mElem) {
        mElem.innerHTML = `
          <span style="display:inline-block; background:${pillBg}; color:${pillFg}; font-weight:700; font-size:11px; padding:0 6px; height:18px; line-height:18px; border-radius:2px; letter-spacing:0.5px;">${pillText}</span>
        `;
      }

      if (cElem) {
        if (this.cmdlineText) {
          cElem.innerHTML = `<span style="color:#00e5ff; font-weight:600;">${this.escapeHtml(this.cmdlineText)}</span><span style="display:inline-block; width:6px; height:12px; background:#00e5ff; vertical-align:middle; margin-left:2px; animation:blink 1s step-end infinite;"></span>`;
        } else {
          cElem.textContent = this.bufferText || '';
        }
      }

      if (posElem) {
        posElem.textContent = `${this.lineNum}L, ${this.colNum}C`;
      }

      if (themeElem) {
        themeElem.textContent = this.ghosttyTheme.name || 'wons';
      }

      if (bElem) {
        bElem.textContent = this.backendText ? `[${this.backendText}]` : '';
      }
    }

    escapeHtml(str) {
      return (str || '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m]);
    }

    updateCursorStyle() {
      if (!this.enabled) { this.restoreCursorStyle(); return; }
      const caret = typeof document !== 'undefined' && typeof document.querySelector === 'function'
        ? document.querySelector('.kix-cursor-caret')
        : null;
      if (caret !== this.styledCaret) this.restoreCursorStyle();
      if (!caret) return;
      if (!this.styledCaret || caret.style.borderWidth !== this.appliedBorderWidth) {
        this.nativeBorders = ['top', 'right', 'bottom', 'left'].map(side => {
          const name = `border-${side}-width`;
          return [name, caret.style.getPropertyValue(name), caret.style.getPropertyPriority(name)];
        });
        this.styledCaret = caret;
      }
      if (this.modeText === 'insert') {
        caret.style.borderWidth = '2px';
      } else {
        try {
          if (caret.style && caret.style.height) {
            const h = parseFloat(caret.style.height.slice(0, -2));
            if (!isNaN(h)) { const w = 0.416 * h; caret.style.borderWidth = w + 'px'; }
          }
        } catch (_) {}
      }
      this.appliedBorderWidth = caret.style.borderWidth;
    }

    restoreCursorStyle() {
      if (this.styledCaret && this.styledCaret.style.borderWidth === this.appliedBorderWidth) {
        for (const [name, value, priority] of this.nativeBorders || []) {
          if (value) this.styledCaret.style.setProperty(name, value, priority);
          else this.styledCaret.style.removeProperty(name);
        }
      }
      this.styledCaret = null;
    }
  }

  window.VimUIV2 = VimUIV2Internal;
  window.VimUI = new VimUIV2Internal();
})();
