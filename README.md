# opencode-plugin-omo-models

opencode TUI sidebar plugin that shows the model assignments configured for
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OMO) agents
and categories.

## What it shows

A bordered `Models` section in the right sidebar (next to Context/MCP/LSP):

- `Agents` — every agent from the OMO config, in config order
- `Categories` — every category from the OMO config, in config order

Each row shows the entry name and the model (the part after the last `/`, e.g.
`openai/gpt-6-astra` → `gpt-6-astra`). Names are padded to a 15-char column and
models are truncated to 16 chars, so every row stays on a single line within the
sidebar width. Longer names and models are truncated with `…`.

## Data source

`~/.omo/omo.jsonc` (JSONC). The plugin strips only full-line `//` comments
before parsing, so the `$schema` URL in the file is preserved. It reads the
`[opencode]` section when present (falling back to the document root) and
renders `agents` and `categories` in the order they appear in the file.

The file is watched with `fs.watch` and also re-read by a 10s fallback poll;
the sidebar updates in place when the content changes. Read or parse errors are
shown as a single `omo.jsonc: ...` line in the error color.

## Install

Build once:

```bash
npm install && npm run build
```

Then register the TUI plugin in `~/.config/opencode/tui.json`:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-plugin-omo-models/src/tui.ts"
  ]
}
```

The `file://` entry points at `src/tui.ts` directly because the opencode Bun
runtime loads TypeScript without a build step. Restart opencode after changing
`tui.json`.

## Development

```bash
npm run typecheck   # tsc -p tsconfig.tui.json (no emit)
npm run build       # emits dist/tui.js
```

`src/tui.ts` is fully self-contained (no relative imports) so it can be loaded
directly as a `file://` plugin entry.
