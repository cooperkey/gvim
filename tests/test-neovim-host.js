/**
 * End-to-end test for the native Neovim bridge.
 *
 * Spawns native-host/host.py, speaks Chrome's native messaging protocol to it,
 * and drives the real MessagePack/RPC/sync-bridge code with a mock Google Docs
 * surface. Every key is fed through nvim_input one token at a time, exactly as
 * DocsInputRouter does, so multi-key commands (dd, cw, J, o, u) are covered.
 *
 * Requires `nvim` and `python3`; skips cleanly when either is missing.
 */

const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const path = require('path');

function have(bin) {
  const result = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return result.status === 0 && !!result.stdout.trim();
}

if (!have('nvim') || !have('python3')) {
  console.log('Skipping native host test: nvim or python3 not found.');
  process.exit(0);
}

global.window = global;
const NvimRpcClient = require('../src/neovim/rpc-client.js');
const DocsSyncBridge = require('../src/bridge/docs-sync.js');

// Chrome native messaging transport, in-process.
class HostTransport {
  constructor(proc) {
    this.proc = proc;
    this.onData = null;
    this.onClose = null;
    this.onReady = null;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    proc.stdout.on('data', chunk => this._feed(chunk));
    proc.on('exit', () => {
      this.connected = false;
      if (this.onClose) this.onClose();
    });
  }
  _feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) return;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      let message;
      try { message = JSON.parse(body.toString('utf8')); } catch (_) { continue; }
      if (message.type === 'ready') {
        this.connected = true;
        if (this.onReady) this.onReady(message);
      } else if (message.type === 'msgpack') {
        if (this.onData) this.onData(new Uint8Array(Buffer.from(message.data, 'base64')));
      }
    }
  }
  _writeFrame(frame) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(frame.length, 0);
    this.proc.stdin.write(Buffer.concat([header, frame]));
  }
  send(bytes) {
    if (!this.connected) return;
    this._writeFrame(Buffer.from(JSON.stringify({
      type: 'msgpack',
      data: Buffer.from(bytes).toString('base64'),
    })));
  }
  sendRaw(text) {
    this._writeFrame(Buffer.from(text, 'utf8'));
  }
  disconnect() {
    try { this.proc.stdin.end(); } catch (_) {}
  }
}

// Stand-in for Google Docs: character offsets, a selection and the document text.
class MockDocs {
  constructor(text) { this.text = text; this.anchor = 0; this.focus = 0; }
  extractDocumentText() { return this.text; }
  caretIndex() { return { index: this.focus, min: 0, max: this.text.length }; }
  setCaretIndex(index, extend) {
    if (extend) this.focus = index;
    else { this.anchor = index; this.focus = index; }
    return true;
  }
  replace(start, end, replacement) {
    this.text = this.text.slice(0, start) + replacement + this.text.slice(end);
  }
}

// Docs always terminates the document with a paragraph mark; the buffer models
// it as a trailing empty line, so compare content without that final newline.
const content = text => (text.endsWith('\n') ? text.slice(0, -1) : text);

(async () => {
  const docs = new MockDocs('alpha beta gamma\ndelta epsilon\nzeta eta theta\n');
  const proc = spawn('python3', [path.join(__dirname, '..', 'native-host', 'host.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, NVIM_APPNAME: process.env.NVIM_APPNAME || 'vimfordocs-test' },
  });
  const transport = new HostTransport(proc);

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('native host never became ready')), 20000);
      transport.onReady = info => { clearTimeout(timer); resolve(info); };
    });

    const nvim = new NvimRpcClient(transport);
    const bridge = new DocsSyncBridge(nvim, docs);
    const syncErrors = [];
    bridge.onSyncError = message => syncErrors.push(message);
    bridge._executeDocsTransaction = async (start, end, replacement) => {
      docs.replace(start, end, replacement);
      return true;
    };

    await bridge.hydrate();
    // A UI is what keeps Neovim's main loop consuming queued input while embedded.
    await nvim.request('nvim_ui_attach', [120, 40, { rgb: true, ext_linegrid: true }]);

    const bufferText = async () => {
      const lines = await nvim.request('nvim_buf_get_lines', [0, 0, -1, false]);
      return lines.join('\n');
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 120));
    const key = async token => {
      await nvim.request('nvim_input', [token]);
      await new Promise(resolve => setTimeout(resolve, 30));
    };
    const keys = async text => {
      for (const char of text) await key(char === '\u0001' ? '<Esc>' : char);
      await settle();
    };
    const type = async text => { await keys(text.replace(/<Esc>/g, '\u0001')); };
    const check = async label => {
      await settle();
      const live = await bufferText();
      assert.strictEqual(
        content(docs.text),
        content(live),
        `${label}: document and buffer diverged\n  docs:   ${JSON.stringify(docs.text)}\n  buffer: ${JSON.stringify(live)}`,
      );
      console.log(`  ✅ ${label}`);
    };

    console.log('  Hydration');
    await keys('u');
    await check('u right after load does not undo the hydration');

    console.log('  Chords and single-line edits');
    await keys('w');
    await keys('x');
    await check('w and x');

    console.log('  Linewise operations');
    await keys('dd');
    await check('dd removes the line and its separator');
    await keys('p');
    await check('linewise p restores the line');
    await keys('j');
    await keys('J');
    await check('J merges paragraphs');

    console.log('  Insert mode');
    await keys('gg');
    await keys('O');
    await type('new<Esc>');
    await check('O opens a line above');
    await keys('u');
    await check('u undoes it in the document');
    await keys('j');
    await keys('A');
    await type(' tail<Esc>');
    await check('A appends at end of line');
    await keys('G');
    await keys('o');
    await type('bottom<Esc>');
    await check('o appends a paragraph at the end');

    console.log('  Change and delete to end');
    await keys('gg');
    await keys('cj');
    await check('cj changes two lines');
    await keys('<Esc>');
    await keys('ggdG');
    await check('dG empties the document');

    console.log('  Host resilience');
    transport.sendRaw('{"type": "msgpack", "data": "!!not-base64!!"}');
    transport.sendRaw('this is not json');
    await new Promise(resolve => setTimeout(resolve, 150));
    await keys('i');
    await type('still alive<Esc>');
    await check('malformed frames do not kill the bridge');

    assert.deepStrictEqual(syncErrors, [], 'no sync failures were reported');
    console.log('\n  ✅ Native Neovim bridge round trip verified.\n');
  } finally {
    try { proc.kill(); } catch (_) {}
  }
})().catch(error => {
  console.error('\n❌ Native host test failed:', error.message);
  process.exit(1);
});
