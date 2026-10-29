# gvim

an opinionated version of [vim-for-docs](https://github.com/greenstorm5417/Vim-For-Docs). it is a browser extension that adds vim-style modal editing to Google Docs: the same idea as upstream, with different defaults and its own set of commands.

this fork is not published to the extension stores. load it unpacked.

## requirements

- Chrome, Edge, Brave, or Firefox
- Google Docs accessibility features turned on, or the extension will not work:
  open a doc, go to tools > accessibility, and enable screen reader support and braille support

## install

1. clone this repository.
2. load the extension from the `src` folder:
   - Chrome: open `chrome://extensions`, turn on developer mode, click load unpacked, and select `src`.
   - Firefox: open `about:debugging#/runtime/this-firefox`, click load temporary add-on, and select `src/manifest.json`.
3. open a Google Doc, enable screen reader support and braille support under tools > accessibility, then reload the doc.
4. click the toolbar icon and make sure the extension is enabled.

## usage

normal mode is the default. the overlay at the bottom of the page shows the current mode on the left and the pending keys on the right.

- navigation: `h` `j` `k` `l`, `w` `b` `e`, `0` `^` `$`, `gg` `G`, `f` `t` `;` `,`, `%`, `{` `}`, `ctrl-d` `ctrl-u` `ctrl-f` `ctrl-b`
- editing: `i` `a` `o` `O`, `esc`, `d` `c` `y` with motions and text objects (`iw`, `aw`, `i(`, `it`), `p` `P`, `>>` `<<`, `g~` `gu` `gU`, `u`, `ctrl-r`, `.`
- visual mode: `v` and `V`, then a motion or an operator
- search: `/` `?` `n` `N`
- ex commands: `:`, including substitutes such as `:s/old/new/g` and `:'<,'>s/old/new/g`
- macros: `q{register}` to record, `q` to stop, `@{register}` to replay
- registers: `"{register}`, with `"+` and `"*` written to the system clipboard
- Docs formatting: space followed by `b` bold, `i` italic, `u` underline, `s` strikethrough, `c` code, `1`-`6` headings, `0` normal text, `7` numbered list, `8` bulleted list, `x` checklist, `k` link, `h` highlight, `\` clear formatting

## configuration

open the toolbar icon for the on/off switch, line numbers, and the theme. the motions editor lets you rebind keys, change text object delimiters, and edit the raw JSON. invalid or conflicting bindings are rejected before they are saved, and changes apply to open Docs tabs.

keys accepted by the editor include `<Left>`, `<Right>`, `<Up>`, `<Down>`, `<SPACE>`, `<ESC>`, `<CR>`, `<BS>`, `<TAB>`, `<Del>`, `<Home>`, `<End>`, `<PageUp>`, `<PageDown>`, and `<F1>`-`<F24>`, plus `C`, `A`, `M`, and `S` modifiers in that order (for example `<C-S-X>`). shortcuts reserved by the browser or the operating system never reach the extension.

## limitations

- search reads a whole-document snapshot of up to 1,000,000 characters.
- a multi-step edit can need more than one native undo.
- registers are kept in tab memory. the `+` and `*` registers write to the system clipboard but do not read from it.
- IME input, toolbar edits, and some browser shortcuts are not captured.
- this is a vim-like layer with its own limits, not a full Neovim.

## development

there is no build step; `src` is the extension. tests run directly with node:

```
node tests/test-pure-engine.js
node tests/test-neovim-bridge.js
node tests/test-neovim-host.js
```

the last test needs `nvim` and `python3` and skips when either is missing. `native-host/` holds the native messaging host for a local Neovim engine.

## credits

based on [vim-for-docs](https://github.com/greenstorm5417/Vim-For-Docs), which continues the work started in [dockeys](https://github.com/tirthd16/dockeys). licensed under the Apache License 2.0.
