import * as fs from "node:fs"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

const HOME = process.env.HOME ?? ""
const OMO_PATH = `${HOME}/.omo/omo.jsonc`
const POLL_MS = 10_000
const NAME_MAX = 15
const MODEL_MAX = 16

interface Entry {
  name: string
  model: string
}

interface Snapshot {
  agents: Entry[]
  categories: Entry[]
}

/**
 * Strips only full-line `//` comments. The file contains a URL in `$schema`,
 * so splitting on `//` anywhere would corrupt the JSON.
 */
function stripLineComments(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
}

function readEntries(root: any, key: string): Entry[] {
  const group = root?.[key]
  if (!group || typeof group !== "object") return []
  const out: Entry[] = []
  for (const [name, cfg] of Object.entries(group as Record<string, any>)) {
    const rawModel = typeof cfg?.model === "string" ? cfg.model : ""
    const model = rawModel ? rawModel.slice(rawModel.lastIndexOf("/") + 1) : "—"
    out.push({ name, model })
  }
  return out
}

function parseSnapshot(raw: string): Snapshot {
  const parsed = JSON.parse(stripLineComments(raw))
  const root = parsed?.["[opencode]"] ?? parsed
  return {
    agents: readEntries(root, "agents"),
    categories: readEntries(root, "categories"),
  }
}

function truncate(value: string, width: number): string {
  if (width <= 0) return value
  if (value.length > width) return `${value.slice(0, width - 1)}…`
  return value
}

function fit(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ")
}

const plugin: TuiPlugin = async (api) => {
  // Use the TUI process's own solid runtime so reactive effects integrate
  // with the host renderer (same approach as built-in sidebar sections).
  const solid = await import("@opentui/solid").catch(() => null)
  if (!solid) return
  const solidjs = await import("solid-js").catch(() => null)
  if (!solidjs || typeof solidjs.createSignal !== "function") return

  const [snap, setSnap] = solidjs.createSignal<Snapshot | null>(null)
  const [err, setErr] = solidjs.createSignal<string | null>(null)
  let disposed = false
  let inFlight = false
  let lastRaw: string | null = null
  let watcher: fs.FSWatcher | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  api.slots.register({
    order: 500,
    slots: {
      sidebar_content() {
        return buildSidebar(solid, api, snap, err)
      },
    },
  })

  const reload = async () => {
    if (disposed || inFlight) return
    inFlight = true
    try {
      const raw = await Bun.file(OMO_PATH).text()
      if (raw === lastRaw && err() === null) return
      lastRaw = raw
      setSnap(parseSnapshot(raw))
      setErr(null)
      api.renderer.requestRender()
    } catch (e) {
      setErr(`omo.jsonc: ${e instanceof Error ? e.message : String(e)}`)
      api.renderer.requestRender()
    } finally {
      inFlight = false
    }
  }

  void reload()

  try {
    watcher = fs.watch(OMO_PATH, { persistent: false }, () => {
      void reload()
    })
  } catch {
    // fs.watch is best-effort; the interval poll below is the fallback.
  }

  timer = setInterval(() => {
    void reload()
  }, POLL_MS)

  api.lifecycle.onDispose(() => {
    disposed = true
    clearInterval(timer)
    watcher?.close()
  })
}

/**
 * Builds a reactive sidebar element: the child list is passed to
 * `solid.insert` as an accessor, so it re-evaluates whenever the underlying
 * signals change — updating the on-screen text even while the TUI is idle.
 */
function buildSidebar(solid: any, api: TuiPluginApi, snap: () => Snapshot | null, err: () => string | null) {
  const theme = api.theme.current
  const box = solid.createElement("box")
  solid.setProp(box, "borderStyle", "single")
  solid.setProp(box, "borderColor", theme.borderSubtle)
  solid.setProp(box, "flexDirection", "column")
  solid.setProp(box, "padding", 1)

  const boldLine = (fg: unknown, value: string) => {
    const line = solid.createElement("text")
    solid.setProp(line, "wrapMode", "none")
    solid.setProp(line, "fg", fg)
    const bold = solid.createElement("b")
    solid.insert(bold, value)
    solid.insert(line, bold)
    return line
  }

  const rowLine = (entry: Entry, nameWidth: number, modelWidth: number, t: any) => {
    const line = solid.createElement("text")
    solid.setProp(line, "wrapMode", "none")
    const nameSpan = solid.createElement("span")
    solid.setProp(nameSpan, "style", { fg: t.text })
    solid.insert(nameSpan, fit(entry.name, nameWidth))
    solid.insert(line, nameSpan)
    const modelSpan = solid.createElement("span")
    solid.setProp(modelSpan, "style", { fg: t.accent })
    solid.insert(modelSpan, ` ${truncate(entry.model, modelWidth)}`)
    solid.insert(line, modelSpan)
    return line
  }

  const children = () => {
    const s = snap()
    const e = err()
    const t = api.theme.current
    const out: any[] = []

    out.push(boldLine(t.info, "Models"))

    if (e) {
      const line = solid.createElement("text")
      solid.setProp(line, "wrapMode", "none")
      solid.setProp(line, "fg", t.error)
      solid.insert(line, e)
      out.push(line)
      return out
    }
    if (!s) return out

    const all = [...s.agents, ...s.categories]
    const nameWidth = Math.min(NAME_MAX, all.reduce((max, entry) => Math.max(max, entry.name.length), 0))
    const modelWidth = Math.min(MODEL_MAX, all.reduce((max, entry) => Math.max(max, entry.model.length), 0))

    out.push(boldLine(t.info, "Agents"))
    for (const entry of s.agents) out.push(rowLine(entry, nameWidth, modelWidth, t))

    const spacer = solid.createElement("text")
    solid.setProp(spacer, "wrapMode", "none")
    solid.insert(spacer, " ")
    out.push(spacer)

    out.push(boldLine(t.info, "Categories"))
    for (const entry of s.categories) out.push(rowLine(entry, nameWidth, modelWidth, t))

    return out
  }

  // Pass an accessor: solid's insert tracks the signals read inside and
  // re-runs it on change, replacing the rendered children.
  solid.insert(box, () => children())
  return box
}

export default {
  id: "omo-models-tui",
  tui: plugin,
} as const
