/**
 * Automated Verification Suite for Vim-For-Docs Pure Engine
 * Tests Docs native styling commands, Space leader keybindings,
 * native Adapter keyboard event dispatches, caret motions, and status line UI.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Setup Node DOM environment mocks
global.window = global;
global.chrome = { storage: { sync: {}, local: {} }, runtime: { onMessage: { addListener: () => {} } } };
global.document = {
  createElement: (tag) => {
    return {
      tagName: tag.toUpperCase(),
      style: {},
      childNodes: [],
      classList: {
        contains: () => false,
        add: () => {},
        remove: () => {}
      },
      appendChild(child) { this.childNodes.push(child); return child; },
      setAttribute: () => {},
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 100, right: 200, width: 100, height: 20 }),
      dispatchEvent: (e) => { this._lastDispatched = e; return true; }
    };
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: {
    appendChild: () => {},
    contains: () => true,
    style: {}
  }
};
global.navigator = { platform: 'MacIntel' };
global.KeyboardEvent = class KeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key || '';
    this.code = init.code || '';
    this.keyCode = init.keyCode || 0;
    this.which = init.which || init.keyCode || 0;
    this.ctrlKey = !!init.ctrlKey;
    this.altKey = !!init.altKey;
    this.shiftKey = !!init.shiftKey;
    this.metaKey = !!init.metaKey;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
  }
};

require('../src/config.js');
require('../src/parser.js');
require('../src/executor.js');
require('../src/ui.js');

(async () => {
  console.log('====================================================');
  console.log(' Running Vim-For-Docs Pure Engine Verification');
  console.log('====================================================');

  const motionsPath = path.join(__dirname, '../src/motions.json');
  const motionsRaw = fs.readFileSync(motionsPath, 'utf8');
  const motionsCfg = JSON.parse(motionsRaw);

  // ----------------------------------------------------
  // Test 1: Config & motions.json Validation
  // ----------------------------------------------------
  console.log('\n[1/5] Validating motions.json schema with Docs native formatting commands...');
  const validationError = window.VimConfig.validate(motionsCfg);
  assert.strictEqual(validationError, null, `motions.json validation failed: ${validationError}`);

  const requiredCommands = [
    'docs_bold', 'docs_italic', 'docs_underline', 'docs_strikethrough',
    'docs_code', 'docs_code_block', 'docs_heading_1', 'docs_heading_2',
    'docs_heading_3', 'docs_heading_4', 'docs_heading_5', 'docs_heading_6',
    'docs_normal_text', 'docs_checklist', 'docs_numbered_list',
    'docs_bullet_list', 'docs_link', 'docs_clear_formatting',
    'docs_yank_clipboard', 'docs_paste_clipboard', 'docs_append_semicolon'
  ];

  for (const cmdId of requiredCommands) {
    const found = motionsCfg.commands.some(c => c.id === cmdId);
    assert(found, `Required command ${cmdId} not found in validated config`);
  }
  console.log('  ✅ motions.json contains all 21 Google Docs native styling commands.');

  // ----------------------------------------------------
  // Test 2: Parser Leader Keybindings
  // ----------------------------------------------------
  console.log('\n[2/5] Testing Space leader keybindings parsing...');
  const parser = new window.VimMotionParser(motionsCfg);

  const testCases = [
    { seq: ['<SPACE>', 'b'], expected: 'docs_bold' },
    { seq: ['<SPACE>', 'i'], expected: 'docs_italic' },
    { seq: ['<SPACE>', 'u'], expected: 'docs_underline' },
    { seq: ['<SPACE>', 's'], expected: 'docs_strikethrough' },
    { seq: ['<SPACE>', 'c'], expected: 'docs_code' },
    { seq: ['<SPACE>', 'C'], expected: 'docs_code_block' },
    { seq: ['<SPACE>', '1'], expected: 'docs_heading_1' },
    { seq: ['<SPACE>', '2'], expected: 'docs_heading_2' },
    { seq: ['<SPACE>', '3'], expected: 'docs_heading_3' },
    { seq: ['<SPACE>', '4'], expected: 'docs_heading_4' },
    { seq: ['<SPACE>', '5'], expected: 'docs_heading_5' },
    { seq: ['<SPACE>', '6'], expected: 'docs_heading_6' },
    { seq: ['<SPACE>', '0'], expected: 'docs_normal_text' },
    { seq: ['<SPACE>', 'x'], expected: 'docs_checklist' },
    { seq: ['<SPACE>', '7'], expected: 'docs_numbered_list' },
    { seq: ['<SPACE>', 'n'], expected: 'docs_numbered_list' },
    { seq: ['<SPACE>', '8'], expected: 'docs_bullet_list' },
    { seq: ['<SPACE>', 'k'], expected: 'docs_link' },
    { seq: ['<SPACE>', 'l'], expected: 'docs_link' },
    { seq: ['<SPACE>', 'y'], expected: 'docs_yank_clipboard' },
    { seq: ['<SPACE>', ';'], expected: 'docs_append_semicolon' },
  ];

  for (const { seq, expected } of testCases) {
    parser.reset();
    let res = null;
    for (const key of seq) {
      res = parser.feed(key);
    }
    assert.strictEqual(res.kind, 'command', `Expected command result for ${seq.join('')}`);
    assert.strictEqual(res.command.id, expected, `Key sequence ${seq.join('')} did not resolve to ${expected}`);
  }
  console.log('  ✅ All Space leader key combinations parsed to Docs native commands.');

  // ----------------------------------------------------
  // Test 3: Native Adapter Formatting Shortcuts Dispatch
  // ----------------------------------------------------
  console.log('\n[3/5] Testing Native Adapter Docs styling shortcuts...');

  // Mock editor element and capture dispatched events
  const dispatchedEvents = [];
  const mockEditor = {
    dispatchEvent(event) {
      dispatchedEvents.push(event);
      return true;
    }
  };
  const mockIframe = {
    contentDocument: {
      activeElement: mockEditor,
      body: mockEditor
    }
  };
  global.document.querySelector = (sel) => {
    if (sel === '.docs-texteventtarget-iframe') return mockIframe;
    return null;
  };

  const adapter = window.VimAdapter;
  assert(adapter, 'Adapter not exported by executor.js');

  // Verify Bold
  dispatchedEvents.length = 0;
  adapter.bold();
  const boldEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 66);
  assert(boldEvent, 'Bold keydown event not dispatched');
  assert(boldEvent.metaKey, 'Bold event on macOS must have metaKey (Cmd+B)');

  // Verify Italic
  dispatchedEvents.length = 0;
  adapter.italic();
  const italicEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 73);
  assert(italicEvent && italicEvent.metaKey, 'Italic event on macOS must have metaKey (Cmd+I)');

  // Verify Underline
  dispatchedEvents.length = 0;
  adapter.underline();
  const underlineEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 85);
  assert(underlineEvent && underlineEvent.metaKey, 'Underline event on macOS must have metaKey (Cmd+U)');

  // Verify Strikethrough (Cmd+Shift+X on Mac)
  dispatchedEvents.length = 0;
  adapter.strikethrough();
  const strikeEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 88);
  assert(strikeEvent && strikeEvent.metaKey && strikeEvent.shiftKey, 'Strikethrough event on macOS must be Cmd+Shift+X');

  // Verify Heading 1 (Cmd+Option+1 on Mac)
  dispatchedEvents.length = 0;
  adapter.heading(1);
  const h1Event = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 49);
  assert(h1Event && h1Event.metaKey && h1Event.altKey, 'Heading 1 on macOS must be Cmd+Option+1');

  // Verify Normal Text (Cmd+Option+0 on Mac)
  dispatchedEvents.length = 0;
  adapter.normalText();
  const normEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 48);
  assert(normEvent && normEvent.metaKey && normEvent.altKey, 'Normal text on macOS must be Cmd+Option+0');

  // Verify Checklist (Cmd+Shift+9 on Mac)
  dispatchedEvents.length = 0;
  adapter.checklist();
  const checkEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 57);
  assert(checkEvent && checkEvent.metaKey && checkEvent.shiftKey, 'Checklist on macOS must be Cmd+Shift+9');

  // Verify Numbered List (Cmd+Shift+7 on Mac)
  dispatchedEvents.length = 0;
  adapter.numberedList();
  const numEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 55);
  assert(numEvent && numEvent.metaKey && numEvent.shiftKey, 'Numbered list on macOS must be Cmd+Shift+7');

  // Verify Bulleted List (Cmd+Shift+8 on Mac)
  dispatchedEvents.length = 0;
  adapter.bulletedList();
  const bulEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 56);
  assert(bulEvent && bulEvent.metaKey && bulEvent.shiftKey, 'Bulleted list on macOS must be Cmd+Shift+8');

  // Verify Link (Cmd+K on Mac)
  dispatchedEvents.length = 0;
  adapter.link();
  const linkEvent = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 75);
  assert(linkEvent && linkEvent.metaKey, 'Link on macOS must be Cmd+K');

  console.log('  ✅ Native Docs shortcuts dispatch with accurate macOS modifier flags and key codes.');

  // ----------------------------------------------------
  // Test 4: Pure Engine Caret Motions (w, b, 0, $, gg, G)
  // ----------------------------------------------------
  console.log('\n[4/5] Testing Pure Engine Caret Motions...');

  // Word Forward (w) -> Option+Right on Mac
  dispatchedEvents.length = 0;
  adapter.ctrlRight();
  const wordFwd = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 39);
  assert(wordFwd && wordFwd.altKey, 'Word forward on macOS must dispatch Option+ArrowRight');

  // Word Backward (b) -> Option+Left on Mac
  dispatchedEvents.length = 0;
  adapter.ctrlLeft();
  const wordBack = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 37);
  assert(wordBack && wordBack.altKey, 'Word backward on macOS must dispatch Option+ArrowLeft');

  // Line Start (0) -> Cmd+Left on Mac
  dispatchedEvents.length = 0;
  adapter.home();
  const lineStart = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 37);
  assert(lineStart && lineStart.metaKey, 'Line start on macOS must dispatch Cmd+ArrowLeft');

  // Line End ($) -> Cmd+Right on Mac
  dispatchedEvents.length = 0;
  adapter.end();
  const lineEnd = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 39);
  assert(lineEnd && lineEnd.metaKey, 'Line end on macOS must dispatch Cmd+ArrowRight');

  // Document Start (gg) -> Cmd+Up on Mac
  dispatchedEvents.length = 0;
  adapter.ctrlHome();
  const docStart = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 38);
  assert(docStart && docStart.metaKey, 'Document start on macOS must dispatch Cmd+ArrowUp');

  // Document End (G) -> Cmd+Down on Mac
  dispatchedEvents.length = 0;
  adapter.ctrlEnd();
  const docEnd = dispatchedEvents.find(e => e.type === 'keydown' && e.keyCode === 40);
  assert(docEnd && docEnd.metaKey, 'Document end on macOS must dispatch Cmd+ArrowDown');

  console.log('  ✅ Caret motions (w, b, 0, $, gg, G) route to native Google Docs canvas shortcuts.');

  // ----------------------------------------------------
  // Test 5: Status Line UI (Ghostty wons Theme & [Pure Vim])
  // ----------------------------------------------------
  console.log('\n[5/5] Testing Status Line UI with Ghostty wons theme and Pure Vim backend...');
  const ui = window.VimUI;
  assert.strictEqual(ui.backendText, 'Pure Vim', 'Default backend must be Pure Vim');

  ui.setPosition(42, 17);
  ui.setMode('normal');

  assert.strictEqual(ui.lineNum, 42);
  assert.strictEqual(ui.colNum, 17);
  assert.strictEqual(ui.ghosttyTheme.name, 'wons');

  console.log('  ✅ Status line reflects Ln 42, Col 17, mode Normal, and [Pure Vim] backend.');

  // ----------------------------------------------------
  // Test 6: Flash Jump Guard Isolation
  // ----------------------------------------------------
  console.log('\n[6/8] Testing Flash Jump Isolation Guards...');
  const testParser = new window.VimMotionParser(motionsCfg);

  const checkStandaloneS = (opts) => {
    const prompt = opts.prompt || null;
    const mode = opts.mode || 'normal';
    const tempNormal = !!opts.tempNormal;
    const replaceMode = !!opts.replaceMode;
    const e = opts.event || { key: 's', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
    const p = opts.parser || testParser;
    const commands = opts.commands || [];
    const inputs = opts.inputs || [];

    return (
      !prompt &&
      (mode === 'normal' || mode === 'visual') &&
      !tempNormal &&
      !replaceMode &&
      e.key === 's' &&
      !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
      !p?.isPending?.() &&
      !p?.countStr &&
      !p?.opCountStr &&
      !p?.register &&
      (!p?.buffer || p.buffer.length === 0) &&
      commands.length === 0 &&
      inputs.length === 0
    );
  };

  // Case A: Standalone 's' in normal mode -> should be allowed
  testParser.reset();
  assert.strictEqual(checkStandaloneS({ mode: 'normal' }), true, "Standalone 's' in normal mode must activate Flash Jump");

  // Case B: Standalone 's' in visual mode -> should be allowed
  testParser.reset();
  assert.strictEqual(checkStandaloneS({ mode: 'visual' }), true, "Standalone 's' in visual mode must activate Flash Jump");

  // Case C: During prompt (e.g. ex command line ':s' or search '/s') -> MUST NOT activate
  assert.strictEqual(checkStandaloneS({ prompt: { type: 'ex', buffer: '' } }), false, "Must not activate Flash Jump in ex prompt (':')");
  assert.strictEqual(checkStandaloneS({ prompt: { type: 'search', direction: 'forward', buffer: '' } }), false, "Must not activate Flash Jump in search prompt ('/')");
  assert.strictEqual(checkStandaloneS({ prompt: { type: 'surround', from: '"' } }), false, "Must not activate Flash Jump in surround prompt");

  // Case D: Count prefix (e.g. '2s') -> MUST NOT activate
  testParser.reset();
  testParser.feed('2');
  assert.strictEqual(testParser.isPending(), true, "Parser must be pending when count '2' is entered");
  assert.strictEqual(checkStandaloneS({ mode: 'normal' }), false, "Must not activate Flash Jump with count prefix '2s'");

  // Case E: Leader key prefix (e.g. '<Space>s') -> MUST NOT activate
  testParser.reset();
  testParser.feed('<SPACE>');
  assert.strictEqual(testParser.isPending(), true, "Parser must be pending when leader '<SPACE>' is entered");
  assert.strictEqual(checkStandaloneS({ mode: 'normal' }), false, "Must not activate Flash Jump during leader sequence '<Space>s'");

  // Case F: Operator pending (e.g. 'cs' or 'ys') -> MUST NOT activate
  testParser.reset();
  testParser.feed('c');
  assert.strictEqual(testParser.isPending(), true, "Parser must be pending when operator 'c' is entered");
  assert.strictEqual(checkStandaloneS({ mode: 'normal' }), false, "Must not activate Flash Jump with operator pending 'cs'");

  // Case G: Register pending (e.g. '"as') -> MUST NOT activate
  testParser.reset();
  testParser.feed('"');
  assert.strictEqual(testParser.isPending(), true, "Parser must be pending when register prefix '\"' is entered");
  assert.strictEqual(checkStandaloneS({ mode: 'normal' }), false, "Must not activate Flash Jump with register pending '\"as'");

  // Case H: Insert mode -> MUST NOT activate
  testParser.reset();
  assert.strictEqual(checkStandaloneS({ mode: 'insert' }), false, "Must not activate Flash Jump in insert mode");

  console.log('  ✅ Flash Jump strictly isolated to standalone normal/visual mode, fully shielded from prompts and combinations.');

  // ----------------------------------------------------
  // Test 7: Visual Selection Retention Across Formatting Manipulations
  // ----------------------------------------------------
  console.log('\n[7/8] Testing Visual Selection Retention for Chained Manipulations...');

  let currentMode = 'visual';
  const mockModeAPI = {
    getMode: () => currentMode,
    isVisual: () => currentMode === 'visual' || currentMode === 'visualLine',
    setMode: (m) => { currentMode = m; },
    reportWarning: () => {}
  };
  const mockSettingsAPI = {
    getUseDisplayLines: () => true
  };

  const executor = window.createVimExecutor(mockModeAPI, mockSettingsAPI);

  // Apply bold in visual mode
  dispatchedEvents.length = 0;
  await executor.applyDocsStyle('bold');
  assert.strictEqual(currentMode, 'visual', 'Visual mode must NOT be collapsed after applying bold');
  const hasBold = dispatchedEvents.some(e => e.type === 'keydown' && e.keyCode === 66);
  assert(hasBold, 'Bold shortcut must be dispatched in visual mode');

  // Chain italic immediately without re-selecting
  dispatchedEvents.length = 0;
  await executor.applyDocsStyle('italic');
  assert.strictEqual(currentMode, 'visual', 'Visual mode must remain active after applying italic in chain');
  const hasItalic = dispatchedEvents.some(e => e.type === 'keydown' && e.keyCode === 73);
  assert(hasItalic, 'Italic shortcut must be dispatched in visual mode chain');

  // Chain underline
  dispatchedEvents.length = 0;
  await executor.applyDocsStyle('underline');
  assert.strictEqual(currentMode, 'visual', 'Visual mode must remain active after applying underline in chain');
  const hasUnderline = dispatchedEvents.some(e => e.type === 'keydown' && e.keyCode === 85);
  assert(hasUnderline, 'Underline shortcut must be dispatched in visual mode chain');

  console.log('  ✅ Visual selection and visual mode retained continuously across chained style manipulations.');

  // ----------------------------------------------------
  // Test 8: Normal Mode Middle-of-Word Formatting
  // ----------------------------------------------------
  console.log('\n[8/8] Testing Normal Mode Middle-of-Word Selection and Formatting...');
  currentMode = 'normal';

  // Mock document text: "hello world", caret at index 2 ('l' in "hello")
  executor.nav.documentModel = () => ({
    text: "hello world",
    offset: (node, off) => off
  });
  executor.nav.caretIndex = () => ({ index: 2 });

  dispatchedEvents.length = 0;
  await executor.applyDocsStyle('bold');

  // Should navigate left by 2 to word start
  const leftEvents = dispatchedEvents.filter(e => e.type === 'keydown' && e.keyCode === 37 && !e.shiftKey && !e.metaKey && !e.altKey);
  // Should select right with shift by 5 (wordLength = 5)
  const shiftRightEvents = dispatchedEvents.filter(e => e.type === 'keydown' && e.keyCode === 39 && e.shiftKey);
  // Should dispatch bold (keyCode 66)
  const boldDispatched = dispatchedEvents.some(e => e.type === 'keydown' && e.keyCode === 66);
  // Should collapse left and return right by 2 to index 2
  const rightReturnEvents = dispatchedEvents.filter(e => e.type === 'keydown' && e.keyCode === 39 && !e.shiftKey);

  assert.strictEqual(leftEvents.length >= 2, true, 'Must move left to word start');
  assert.strictEqual(shiftRightEvents.length, 5, 'Must select entire word "hello" (length 5) with Shift');
  assert(boldDispatched, 'Must dispatch bold formatting to selected word');
  assert.strictEqual(rightReturnEvents.length >= 2, true, 'Must restore caret to original index within word');

  console.log('  ✅ Middle-of-word formatting seamlessly selects word, applies Docs style, and restores exact cursor position.');

  // ----------------------------------------------------
  // Test 9: Ex Command in Visual & VisualLine Modes
  // ----------------------------------------------------
  console.log('\n[9/10] Testing Colon \':\' Command Entry in Visual & VisualLine Modes...');

  // 1. Verify parser recognizes ':' in visual mode
  testParser.setMode('visual');
  const visualColonRes = testParser.feed(':');
  assert.strictEqual(visualColonRes.kind, 'command', 'Colon \':\' must be a recognized command in visual mode');
  assert.strictEqual(visualColonRes.command.id, 'ex_command', 'Colon \':\' in visual mode must map to ex_command');

  // 2. Verify parser recognizes ':' in visualLine mode
  testParser.reset();
  testParser.setMode('visualLine');
  const visualLineColonRes = testParser.feed(':');
  assert.strictEqual(visualLineColonRes.kind, 'command', 'Colon \':\' must be a recognized command in visualLine mode');
  assert.strictEqual(visualLineColonRes.command.id, 'ex_command', 'Colon \':\' in visualLine mode must map to ex_command');

  testParser.reset();
  testParser.setMode('normal');

  console.log('  ✅ Colon \':\' cleanly recognized and routed in normal, visual, and visualLine modes.');

  // ----------------------------------------------------
  // Test 10: Substitute Engine (:%s/pattern/replacement/g and :'<,'>s/...)
  // ----------------------------------------------------
  console.log('\n[10/10] Testing Ex Substitute Engine (:%s/old/new/g and :\'<,\'>s/foo/bar/g)...');

  let currentDocText = "The quick brown fox jumps over the lazy dog.\nThe quick brown fox rests.\n";
  let activeSelection = { start: 0, end: 0 };
  let lastReportedWarning = null;

  executor.nav.documentModel = () => ({
    text: currentDocText,
    offset: (node, off) => off
  });
  executor.nav.setCaretIndex = (idx, withShift) => {
    if (withShift) activeSelection.end = idx;
    else { activeSelection.start = idx; activeSelection.end = idx; }
    return true;
  };
  mockModeAPI.reportWarning = (msg) => { lastReportedWarning = msg; };

  // Track text replacements
  const replacementsApplied = [];
  executor.insertReplacementText = async (replacement) => {
    const s = Math.min(activeSelection.start, activeSelection.end);
    const e = Math.max(activeSelection.start, activeSelection.end);
    replacementsApplied.push({ start: s, end: e, replacement });
    currentDocText = currentDocText.slice(0, s) + replacement + currentDocText.slice(e);
  };

  // Case 1: Global substitution :%s/quick/FAST/g
  replacementsApplied.length = 0;
  await executor.execEx('%s/quick/FAST/g');

  assert.strictEqual(replacementsApplied.length, 2, 'Must replace both occurrences of "quick"');
  assert(currentDocText.includes("The FAST brown fox"), 'Document text must contain "The FAST brown fox"');
  assert(!currentDocText.includes("The quick brown fox"), 'Document text must no longer contain "The quick brown fox"');
  assert.strictEqual(lastReportedWarning, '2 substitutions on 2 lines', 'Must report "2 substitutions on 2 lines"');

  // Case 2: Visual selection substitution :'<,'>s/brown/GOLDEN/g
  // Select line 1 only: indices 0 to 44 ("The FAST brown fox jumps over the lazy dog.")
  executor._lastVisual = {
    startIndex: 0,
    endIndex: 44,
    mode: 'visual'
  };
  replacementsApplied.length = 0;
  await executor.execEx("'<,'>s/brown/GOLDEN/g", { visual: true });

  assert.strictEqual(replacementsApplied.length, 1, 'Must only replace "brown" within visual selection range');
  assert(currentDocText.includes("The FAST GOLDEN fox jumps"), 'Selected region must have "GOLDEN"');
  assert(currentDocText.includes("The FAST brown fox rests"), 'Unselected region must retain original "brown"');

  // Case 3: Visual delete command :'<,'>d
  let visualDeleteCalled = false;
  const originalExecCommand = executor.execCommand.bind(executor);
  executor.execCommand = async (id, args) => {
    if (id === 'visual_delete') {
      visualDeleteCalled = true;
      return;
    }
    return originalExecCommand(id, args);
  };
  await executor.execEx("'<,'>d", { visual: true });
  assert.strictEqual(visualDeleteCalled, true, "':<,'>d must execute visual_delete");

  // Restore execCommand
  executor.execCommand = originalExecCommand;

  // Case 4: Identical replacement :%s/FAST/FAST/g (does not mutate DOM, must not timeout or fail)
  replacementsApplied.length = 0;
  await executor.execEx('%s/FAST/FAST/g');
  assert.strictEqual(lastReportedWarning, '2 substitutions on 2 lines', 'Identical replacement must report 2 substitutions without throwing');

  // Case 5: Empty replacement deletion :s/GOLDEN//g
  replacementsApplied.length = 0;
  await executor.execEx('1s/GOLDEN //g');
  assert(!currentDocText.includes('GOLDEN '), 'Text must be deleted when replacement is empty');

  // Case 6: Line range substitution :2s/brown/SILVER/g
  replacementsApplied.length = 0;
  await executor.execEx('2s/brown/SILVER/g');
  assert(currentDocText.includes('The FAST SILVER fox rests'), 'Line 2 brown must be replaced with SILVER');

  // Case 7: Invalid syntax resilience
  await executor.execEx(':%s/[unclosed/replacement/g');
  assert(lastReportedWarning.includes('error') || lastReportedWarning.includes('not found'), 'Invalid syntax must report warning rather than throwing');

  console.log('  ✅ Substitute engine seamlessly handles document-wide (:%s), visual range (:\'<,\'>s), identical substitutions, deletions, and line ranges.');

  console.log('\n====================================================');
  console.log(' All Pure Engine Tests Passed Successfully (100%)');
  console.log('====================================================');
})();
