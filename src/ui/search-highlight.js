/**
 * Search Highlight Overlay for Google Docs
 * Renders high-contrast visual search match boxes over the Google Docs viewport.
 */

(() => {
  class SearchHighlightOverlay {
    constructor() {
      this.container = null;
      this.matches = [];
      this.currentPattern = null;
      this.activeIndex = -1;
      this._ensureContainer();
    }

    _ensureContainer() {
      if (this.container && document.body.contains(this.container)) return;
      this.container = document.createElement('div');
      this.container.id = 'vim-search-highlight-layer';
      Object.assign(this.container.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '9998',
        overflow: 'visible'
      });
      document.body.appendChild(this.container);
    }

    /**
     * Highlights all occurrences of pattern in text.
     * @param {string} pattern
     * @param {string} fullText
     * @param {number} activeOffset
     */
    highlight(pattern, fullText, activeOffset = -1) {
      this.clear();
      if (!pattern || !fullText) return;

      this._ensureContainer();
      this.currentPattern = pattern;
      this.activeIndex = activeOffset;

      // Smart case: if pattern is all lowercase, case-insensitive; otherwise case-sensitive
      const isCaseSensitive = /[A-Z]/.test(pattern);
      const flags = isCaseSensitive ? 'g' : 'gi';

      let regex;
      try {
        regex = new RegExp(pattern, flags);
      } catch (_) {
        // Fallback to literal search if invalid regex
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, flags);
      }

      const matches = [];
      let match;
      while ((match = regex.exec(fullText)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0]
        });
        if (matches.length > 500) break; // Safety cap
      }

      this.matches = matches;
      this._renderHighlights();
    }

    _renderHighlights() {
      if (!this.container) return;
      this.container.innerHTML = '';

      // Try finding rendered text in Google Docs DOM
      const textNodes = [];
      const walker = document.createTreeWalker(
        document.querySelector('.kix-appview-editor') || document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.trim().length > 0) {
          textNodes.push(node);
        }
      }

      if (!this.currentPattern || textNodes.length === 0) return;

      const patternLower = this.currentPattern.toLowerCase();
      const isCaseSensitive = /[A-Z]/.test(this.currentPattern);

      for (const tNode of textNodes) {
        const val = tNode.nodeValue;
        const compareVal = isCaseSensitive ? val : val.toLowerCase();
        const comparePat = isCaseSensitive ? this.currentPattern : patternLower;

        let pos = 0;
        while ((pos = compareVal.indexOf(comparePat, pos)) !== -1) {
          const matchLen = this.currentPattern.length;
          try {
            const range = document.createRange();
            range.setStart(tNode, pos);
            range.setEnd(tNode, pos + matchLen);

            const rects = range.getClientRects();
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i];
              if (r.width === 0 || r.height === 0) continue;

              const box = document.createElement('div');
              box.className = 'vim-search-box';
              Object.assign(box.style, {
                position: 'fixed',
                left: `${r.left}px`,
                top: `${r.top}px`,
                width: `${r.width}px`,
                height: `${r.height}px`,
                backgroundColor: 'rgba(255, 235, 59, 0.38)',
                border: '1px solid rgba(255, 214, 0, 0.8)',
                borderRadius: '2px',
                pointerEvents: 'none',
                boxSizing: 'border-box',
                zIndex: '9998'
              });
              this.container.appendChild(box);
            }
          } catch (_) {}
          pos += matchLen;
        }
      }
    }

    clear() {
      this.matches = [];
      this.currentPattern = null;
      this.activeIndex = -1;
      if (this.container) {
        this.container.innerHTML = '';
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.SearchHighlightOverlay = new SearchHighlightOverlay();
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SearchHighlightOverlay;
  }
})();
