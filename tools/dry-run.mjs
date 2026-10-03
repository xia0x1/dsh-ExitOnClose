/**
 * Manual dry run: watch the desktop application the way the plugin does and
 * print what the close button would end, without ending anything.
 *
 * The plugin cannot be observed this way from outside — it watches from inside
 * the Host child process — so this probe applies the same rule to the same
 * windows. It must run under the application's own binary in Node mode, so that
 * `process.execPath` is the shell's executable and the window filter matches:
 *
 *   PowerShell:
 *     $env:ELECTRON_RUN_AS_NODE = '1'
 *     & 'F:\deepseekharness\DeepSeek Harness.exe' tools\dry-run.mjs
 *
 * It prints the windows it observes, and when you close the window it prints the
 * process tree it would terminate. Nothing is terminated.
 *
 * Options:
 *   --interval <ms>   poll period, default 250
 */
import { appWindows, processTable } from '../src/desktop.js'
import { ancestorsOf, treeOf } from '../src/process-tree.js'

const args = process.argv.slice(2)
const intervalIndex = args.indexOf('--interval')
const interval = intervalIndex === -1 ? 250 : Number(args[intervalIndex + 1])

const table = processTable()
const ancestors = ancestorsOf(table, process.pid)
const ownerPids = new Set(ancestors.map(ancestor => ancestor.pid))
console.log(`[dry-run] self=${String(process.pid)} execPath=${process.execPath}`)
console.log(`[dry-run] ancestors=${ancestors.map(row => `${String(row.pid)}:${row.exe}`).join(', ') || '(none)'}`)
console.log(`[dry-run] interval=${String(interval)}ms — run this under the shell's own binary or no window will match`)

let status
let armed = false
let hiddenTicks = 0
setInterval(() => {
  const windows = appWindows(ownerPids, process.execPath)
  const visible = windows.filter(window => window.visible).length
  const next = `${String(visible)}/${String(windows.length)}`
  if (next !== status) {
    status = next
    console.log(`[dry-run] windows visible=${String(visible)} total=${String(windows.length)}`)
  }
  if (visible > 0) {
    armed = true
    hiddenTicks = 0
    return
  }
  if (!armed || windows.length === 0) return
  if (++hiddenTicks < 2) return
  const shellPid = windows[0].pid
  console.log(`[dry-run] close detected: shell=${String(shellPid)} would terminate=${JSON.stringify(treeOf(processTable(), shellPid))}`)
  armed = false
  hiddenTicks = 0
}, interval)
