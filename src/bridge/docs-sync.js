/**
 * Google Docs Synchronization Bridge (DocsSyncBridge)
 * Keeps a headless Neovim buffer in sync with Google Docs' collaborative document canvas.
 * Computes minimal differential edits and issues atomic OT-safe transactions.
 */

(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  class DocsSyncBridge {
    constructor(rpcClient, navigator) {
      this.nvim = rpcClient;
      this.nav = navigator;
      this.shadowLines = [];
      this.lineStartOffsets = [0];
      this.bufHandle = 0; // 0 represents current buffer
      this.isApplyingToDocs = false;
      this.hydrated = false;
      // Buffer writes we issued ourselves; their echo events must not be
      // applied back to the document. Matched on the reported change range.
      this._selfWrites = [];
      this.onSyncError = null; // (message) => void, set by content.js
      // Neovim notifications are applied one at a time: a transaction has to
      // finish before the next event is measured against the shadow text.
      this._tail = Promise.resolve();

      // Register listener for buffer changes from Neovim
      this.nvim.on('nvim_buf_lines_event', (params) => this._onNvimBufLines(params));
    }

    /**
     * Initializes Neovim buffer with the text currently loaded in Google Docs.
     */
    async hydrate() {
      let rawText = '';
      if (this.nav && typeof this.nav.extractFullDocumentText === 'function') {
        try {
          rawText = await this.nav.extractFullDocumentText();
        } catch (_) {
          rawText = this.nav.extractDocumentText ? this.nav.extractDocumentText() : '';
        }
      } else if (this.nav && typeof this.nav.extractDocumentText === 'function') {
        rawText = this.nav.extractDocumentText();
      }
      const lines = rawText.length > 0 ? rawText.split('\n') : [''];
      this.shadowLines = [...lines];
      this._recomputeLineOffsets();

      console.log(`[DocsSync] Hydrating Neovim buffer with ${lines.length} lines (${rawText.length} chars)`);

      try {
        // Replace the buffer and its undo history in one call: without dropping
        // the history, a single `u` after load would undo the hydration itself
        // and delete the whole document.
        await this.nvim.request('nvim_exec_lua', [
          `local saved = vim.o.undolevels
           vim.o.undolevels = -1
           vim.api.nvim_buf_set_lines(0, 0, -1, true, ...)
           vim.o.undolevels = saved`,
          [lines],
        ]);
        // Attach to buffer line updates
        await this.nvim.request('nvim_buf_attach', [0, false, {}]);
        // Set filetype to markdown so user's ~/.config/nvim/lua/coop/remap.lua
        // FileType autocmd fires and registers all personal markdown workflow shortcuts:
        // <leader>b, <leader>i, <leader>h, <leader>s, <leader>c, <leader>x, <leader>1..6
        try {
          await this.nvim.request('nvim_set_option_value', ['filetype', 'markdown', { buf: 0 }]);
          await this.nvim.request('nvim_exec2', ['doautocmd FileType markdown', {}]);
        } catch (_) {}
        this.hydrated = true;

        // Synchronize initial Neovim window cursor to Google Docs caret position
        try {
          const ci = this.nav?.caretIndex ? this.nav.caretIndex() : null;
          if (ci && Number.isInteger(ci.index) && ci.index >= 0) {
            const { row, col } = this.offsetToRowCol(ci.index);
            await this.nvim.request('nvim_win_set_cursor', [0, [row + 1, col]]);
            console.log(`[DocsSync] Synchronized initial cursor to Docs caret at row ${row}, col ${col} (offset ${ci.index})`);
          }
        } catch (_) {}

        console.log('[DocsSync] Neovim buffer attached, configured as markdown, and synchronized');
      } catch (err) {
        console.error('[DocsSync] Hydration failed:', err);
        throw err;
      }
    }

    /**
     * Resynchronizes Neovim buffer from the latest Google Docs document text
     * (called upon exiting insert mode or after user edits).
     */
    async resyncFromDocs() {
      if (this.isApplyingToDocs) return;
      try {
        const rawText = this.nav.extractDocumentText ? this.nav.extractDocumentText() : '';
        const lines = rawText.length > 0 ? rawText.split('\n') : [''];
        const previousLineCount = this.shadowLines.length;
        this.shadowLines = [...lines];
        this._recomputeLineOffsets();

        await this._setBufferLines(0, -1, lines, previousLineCount);

        const ci = this.nav.caretIndex ? this.nav.caretIndex() : null;
        if (ci && typeof ci.index === 'number') {
          const { row, col } = this.offsetToRowCol(ci.index);
          await this.nvim.request('nvim_win_set_cursor', [0, [row + 1, col]]);
        }
      } catch (err) {
        console.warn('[DocsSync] resyncFromDocs failed:', err);
      }
    }

    /**
     * Writes buffer lines and remembers the write so its own change event is
     * not echoed back into Google Docs.
     */
    async _setBufferLines(first, last, lines, reportedLast = last) {
      const entry = {
        first,
        last: last === -1 ? reportedLast : last,
        lines: [...lines],
      };
      this._selfWrites.push(entry);
      if (this._selfWrites.length > 32) this._selfWrites.shift();
      try {
        await this.nvim.request('nvim_buf_set_lines', [0, first, last, false, lines]);
      } catch (err) {
        const index = this._selfWrites.indexOf(entry);
        if (index >= 0) this._selfWrites.splice(index, 1);
        throw err;
      }
    }

    _consumeSelfWrite(firstline, lastline, linedata) {
      const index = this._selfWrites.findIndex(write =>
        write.first === firstline && write.last === lastline &&
        write.lines.length === linedata.length &&
        write.lines.every((line, i) => line === linedata[i]));
      if (index < 0) return false;
      this._selfWrites.splice(0, index + 1);
      return true;
    }

    _enqueue(task) {
      const run = this._tail.then(task, task).catch(err => {
        console.error('[DocsSync] Buffer event failed:', err);
      });
      this._tail = run;
      return run;
    }

    /**
     * Called when Neovim modifies the buffer (e.g. operators, motions, substitutions, macros).
     * params: [bufHandle, changedtick, firstline, lastline, linedata, more]
     */
    _onNvimBufLines(params) {
      if (!Array.isArray(params) || params.length < 5) return;
      const [, changedtick, firstline, lastline, linedata] = params;
      // changedtick null means the display changed but not the buffer (e.g. an
      // 'inccommand' preview); applying those would write preview text into Docs.
      if (changedtick === null || changedtick === undefined) return;
      if (!Array.isArray(linedata)) return;
      // lastline is -1 on the initial update that follows nvim_buf_attach.
      if (!Number.isInteger(firstline) || firstline < 0) return;
      if (!Number.isInteger(lastline) || lastline < 0) return;
      return this._enqueue(() => this._applyFromNvim(firstline, lastline, linedata));
    }

    async _applyFromNvim(firstline, lastline, linedata) {
      // Events echoed by our own writes must not travel back to Docs.
      if (this._consumeSelfWrite(firstline, lastline, linedata)) return;
      if (!this.hydrated) return;
      this.isApplyingToDocs = true;
      try {
        await this._applyDiffToDocs(firstline, lastline, linedata);
      } catch (e) {
        console.error('[DocsSync] Failed to apply Neovim diff to Google Docs:', e);
        if (this.onSyncError) this.onSyncError('Document edit could not be applied; text may be out of sync.');
      } finally {
        this.isApplyingToDocs = false;
      }
    }

    /**
     * Computes the exact character difference and executes an atomic Google Docs transaction.
     */
    async _applyDiffToDocs(firstline, lastline, linedata) {
      const lineCount = this.shadowLines.length;
      const first = Math.min(Math.max(0, firstline), lineCount);
      const last = Math.min(Math.max(first, lastline), lineCount);
      const rows = this.shadowLines.slice(first, last);
      const baseOffset = this._getLineOffset(first);

      // A linewise change also moves the separator that terminates the affected
      // block. Deleting row 1 of "a\nb\nc" removes "b\n", not just "b", otherwise
      // the document keeps an empty paragraph behind.
      const hasFollowingRow = last < lineCount;
      const oldText = rows.length
        ? rows.join('\n') + (hasFollowingRow ? '\n' : '')
        : '';
      let newText = '';
      if (linedata.length) {
        if (hasFollowingRow) newText = linedata.join('\n') + '\n';
        else if (rows.length) newText = linedata.join('\n');
        // Inserting after the final row needs the newline that starts it.
        else newText = '\n' + linedata.join('\n');
      }

      // The shadow must follow every event, including one that only moves a
      // trailing separator; otherwise its line count drifts from Neovim's.
      const unchanged = oldText === newText;
      this.shadowLines.splice(first, last - first, ...linedata);
      // A buffer always has at least one line, even after everything is deleted.
      if (!this.shadowLines.length) this.shadowLines.push('');
      this._recomputeLineOffsets();
      if (unchanged) {
        await this._ensureFinalParagraphMark();
        return;
      }

      // Compute common prefix length
      let p = 0;
      const minLen = Math.min(oldText.length, newText.length);
      while (p < minLen && oldText.charCodeAt(p) === newText.charCodeAt(p)) {
        p++;
      }

      // Compute common suffix length (ensuring no overlap with prefix)
      let s = 0;
      while (
        s < (minLen - p) &&
        oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)
      ) {
        s++;
      }

      const deleteStart = baseOffset + p;
      const deleteEnd = baseOffset + (oldText.length - s);
      const replacement = newText.slice(p, newText.length - s);

      // Execute atomic transaction in Google Docs
      await this._executeDocsTransaction(deleteStart, deleteEnd, replacement);
      await this._ensureFinalParagraphMark();
    }

    /**
     * Docs always keeps a final paragraph mark, so the buffer mirrors it with a
     * trailing empty line. Restore it when an edit consumed it; otherwise every
     * later end-of-document offset is short by one newline.
     */
    async _ensureFinalParagraphMark() {
      if (this.shadowLines[this.shadowLines.length - 1] === '') return;
      const at = this.shadowLines.length;
      this.shadowLines.push('');
      this._recomputeLineOffsets();
      await this._setBufferLines(at, at, ['']);
    }

    /**
     * Selects [start, end] and replaces with `replacement` using native beforeinput.
     * Returns true when the edit was dispatched to the editor.
     */
    async _executeDocsTransaction(startOffset, endOffset, replacement) {
      const nav = this.nav;
      if (!nav || typeof nav.setCaretIndex !== 'function') return false;

      // Position caret at start and extend selection to end
      if (!nav.setCaretIndex(startOffset, false)) {
        console.warn(`[DocsSync] Failed to set start caret at ${startOffset}`);
        return false;
      }
      if (endOffset > startOffset) {
        nav.setCaretIndex(endOffset, true);
      }

      const iframe = document.querySelector(".docs-texteventtarget-iframe");
      const doc = iframe?.contentDocument;
      const target = doc?.querySelector('[contenteditable="true"]') || doc?.body;

      if (!target) {
        console.warn('[DocsSync] Google Docs editor target unavailable');
        return false;
      }

      target.focus();

      // Docs applies accessibility selections asynchronously; dispatching in the
      // same turn would replace whatever the previous selection was.
      await this._waitForDocs({ timeoutMs: 150 });

      let ev;
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", replacement);
        ev = new InputEvent("beforeinput", {
          // An empty replacement with a live selection is a deletion, and Docs
          // ignores insertReplacementText with no data.
          inputType: replacement === '' && endOffset > startOffset
            ? "deleteContentForward"
            : "insertReplacementText",
          data: replacement,
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
        });
      } catch (err) {
        console.error('[DocsSync] Transaction dispatch failed:', err);
        return false;
      }

      let dispatched = false;
      await this._waitForDocs({
        timeoutMs: 1000,
        observeMutations: true,
        action: () => {
          // Docs may have replaced its editor iframe while we waited.
          if (!target.isConnected) return;
          dispatched = true;
          target.dispatchEvent(ev);
        },
      });
      if (!dispatched) return false;

      // Wait for Docs to render the edit before the next diff is measured.
      await this._waitForDocs({ timeoutMs: 200, observeMutations: true });
      return true;
    }

    _waitForDocs({ timeoutMs = 250, action, observeSelection = true, observeMutations = false } = {}) {
      const wait = typeof window !== 'undefined' && typeof window.waitForDocsResponse === 'function'
        ? window.waitForDocsResponse
        : null;
      if (!wait || typeof document === 'undefined') {
        return sleep(0).then(() => { if (action) action(); });
      }
      return wait({
        timeoutMs,
        quietMs: 40,
        observeSelection,
        observeMutations,
        ...(action ? { action } : {}),
      }).catch(() => { if (action) action(); });
    }

    _getLineOffset(lineIdx) {
      if (lineIdx < 0) return 0;
      if (lineIdx >= this.lineStartOffsets.length) {
        // One past the last line is the end of the document text.
        return this._textLength();
      }
      return this.lineStartOffsets[lineIdx];
    }

    _textLength() {
      let total = 0;
      for (let i = 0; i < this.shadowLines.length; i++) total += this.shadowLines[i].length + 1;
      // Every line except the last is followed by one newline in the document text.
      return Math.max(0, total - 1);
    }

    _recomputeLineOffsets() {
      this.lineStartOffsets = new Array(this.shadowLines.length);
      let acc = 0;
      for (let i = 0; i < this.shadowLines.length; i++) {
        this.lineStartOffsets[i] = acc;
        acc += this.shadowLines[i].length + 1; // +1 for newline separator
      }
    }

    /**
     * Converts a Neovim 0-based (row, col) into a Google Docs character offset.
     */
    rowColToOffset(row, col) {
      const lineOffset = this._getLineOffset(row);
      const line = this.shadowLines[row] || '';
      const clampedCol = Math.min(Math.max(0, col), line.length);
      return lineOffset + clampedCol;
    }

    /**
     * Converts a Google Docs character offset into a Neovim 0-based (row, col).
     */
    offsetToRowCol(offset) {
      if (!Array.isArray(this.shadowLines) || this.shadowLines.length === 0) {
        return { row: 0, col: 0 };
      }
      let current = 0;
      for (let i = 0; i < this.shadowLines.length; i++) {
        const lineLen = this.shadowLines[i].length;
        if (offset <= current + lineLen) {
          return { row: i, col: Math.max(0, offset - current) };
        }
        current += lineLen + 1; // +1 for \n
      }
      const lastRow = this.shadowLines.length - 1;
      return { row: lastRow, col: this.shadowLines[lastRow].length };
    }
  }

  if (typeof window !== 'undefined') {
    window.DocsSyncBridge = DocsSyncBridge;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DocsSyncBridge;
  }
})();
