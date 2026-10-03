/**
 * Win32 layer for dsh-ExitOnClose.
 *
 * The Electron shell treats the window close button as "hide to the tray" and
 * gives plugins no interception point: this plugin runs in the separate Host
 * child process, and the shell accepts only a fixed set of IPC messages from
 * it. The one signal that does cross that boundary is the window itself, so
 * this module observes the application's own top-level windows through user32
 * and reports the single transition that means the user closed the window:
 *
 *   visible -> invisible
 *
 * A minimized window keeps `WS_VISIBLE`, so minimizing never triggers, and the
 * shell's own `hide()` clears it, so the close button always does. A window
 * that was never on screen cannot arm the watch, and one invisible tick is not
 * enough, so a transient gap between two windows cannot end the application.
 *
 * `koffi` is imported by `src/index.js` only when the plugin mounts. It ships
 * prebuilt binaries for every supported platform and runs no install script.
 */
import koffi from 'koffi'
import { ancestorsOf, treeOf } from './process-tree.js'

const TH32CS_SNAPPROCESS = 0x2
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const GW_OWNER = 4
/** `sizeof(PROCESSENTRY32W)` on x64, which `Process32FirstW` requires up front. */
const PROCESSENTRY32W_SIZE = 568
/** Chromium's class for a real top-level application window. */
const WINDOW_CLASS = /^Chrome_WidgetWin_1/

let win32

/** Build the Win32 surface once, on first use. */
function api() {
  if (win32 !== undefined) return win32
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('char16_t', 260),
  })
  win32 = {
    enumWindows: user32.func('bool EnumWindows(void *lpEnumFunc, intptr_t lParam)'),
    isWindowVisible: user32.func('bool IsWindowVisible(intptr_t hWnd)'),
    getWindow: user32.func('intptr_t GetWindow(intptr_t hWnd, uint32 cmd)'),
    getWindowThreadProcessId: user32.func('uint32 GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32 *pid)'),
    getClassNameW: user32.func('int GetClassNameW(intptr_t hWnd, _Out_ uint16 *buf, int n)'),
    openProcess: kernel32.func('intptr_t OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    closeHandle: kernel32.func('bool CloseHandle(intptr_t handle)'),
    queryImage: kernel32.func('bool QueryFullProcessImageNameW(intptr_t handle, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)'),
    createSnapshot: kernel32.func('intptr_t CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
    process32First: kernel32.func('bool Process32FirstW(intptr_t snapshot, _Inout_ PROCESSENTRY32W *entry)'),
    process32Next: kernel32.func('bool Process32NextW(intptr_t snapshot, _Inout_ PROCESSENTRY32W *entry)'),
    callbackProto: koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hWnd, intptr_t lParam)'),
  }
  return win32
}

/** Class name of one window. */
function className(hwnd) {
  const buffer = Buffer.alloc(1024)
  const length = api().getClassNameW(hwnd, buffer, 512)
  return buffer.toString('utf16le', 0, Math.max(0, length) * 2)
}

/** Every running process with its parent, from one toolhelp snapshot. */
export function processTable() {
  const w = api()
  const snapshot = w.createSnapshot(TH32CS_SNAPPROCESS, 0)
  if (snapshot === 0 || snapshot === -1) return []
  const rows = []
  try {
    const entry = { dwSize: PROCESSENTRY32W_SIZE }
    for (let more = w.process32First(snapshot, entry); more; more = w.process32Next(snapshot, entry)) {
      rows.push({ pid: entry.th32ProcessID, ppid: entry.th32ParentProcessID, exe: entry.szExeFile })
      entry.dwSize = PROCESSENTRY32W_SIZE
    }
  } finally {
    w.closeHandle(snapshot)
  }
  return rows
}

/** Absolute image path of one process, or undefined when it cannot be read. */
export function processImage(pid) {
  const w = api()
  const handle = w.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (handle === 0) return undefined
  try {
    const size = Buffer.alloc(4)
    size.writeUInt32LE(32768, 0)
    const name = Buffer.alloc(65536)
    if (!w.queryImage(handle, 0, name, size)) return undefined
    return name.toString('utf16le', 0, size.readUInt32LE(0) * 2)
  } finally {
    w.closeHandle(handle)
  }
}

/**
 * The application's own top-level windows: Chromium windows owned by an
 * ancestor that runs this same executable. The executable check keeps a
 * launcher such as `explorer.exe`, which is in every desktop ancestry, from
 * ever contributing a window.
 *
 * @param ownerPids - ancestor process ids allowed to own them.
 * @param imagePath - `process.execPath`, the shell's own binary.
 */
export function appWindows(ownerPids, imagePath) {
  const w = api()
  const found = []
  const callback = koffi.register((hwnd) => {
    if (w.getWindow(hwnd, GW_OWNER) !== 0) return true // owned: a dialog or a popup
    if (!WINDOW_CLASS.test(className(hwnd))) return true
    const pidBuffer = Buffer.alloc(4)
    w.getWindowThreadProcessId(hwnd, pidBuffer)
    const pid = pidBuffer.readUInt32LE(0)
    if (!ownerPids.has(pid)) return true
    if (processImage(pid)?.toLowerCase() !== imagePath.toLowerCase()) return true
    found.push({ hwnd, pid, visible: w.isWindowVisible(hwnd) })
    return true
  }, koffi.pointer(w.callbackProto))
  try {
    w.enumWindows(callback, 0)
  } finally {
    koffi.unregister(callback)
  }
  return found
}

/**
 * End the desktop application: the shell that owns the window first, then every
 * other process in its tree. The caller's own process is skipped, because
 * terminating it here would abandon the remaining targets; it exits itself once
 * this returns.
 *
 * `process.kill` is TerminateProcess on Windows, one request per process, so a
 * process that already exited is simply not counted.
 *
 * @param shellPid - process that owns the application window.
 * @param selfPid - the caller, never killed here.
 * @returns number of processes the system accepted a termination for.
 */
export function terminateApplication(shellPid, selfPid = process.pid) {
  const tree = treeOf(processTable(), shellPid)
  let killed = 0
  for (const pid of [shellPid, ...tree.filter(pid => pid !== shellPid && pid !== selfPid)]) {
    try {
      process.kill(pid, 'SIGKILL')
      killed++
    } catch {
      // Already gone, or not ours to end: the next target still matters.
    }
  }
  return killed
}

/**
 * Watch the application for the close button.
 *
 * @param options.onClosed - called once with the shell's process id.
 * @param options.onSkip - called with a reason when the watch stays inert.
 * @param options.intervalMs - poll period; 250 ms is imperceptible and cheap.
 * @param options.confirmations - consecutive invisible ticks required.
 * @returns disposer that stops the watch.
 */
export function watchForClose({ onClosed, onSkip = () => {}, intervalMs = 250, confirmations = 2 } = {}) {
  if (process.platform !== 'win32') {
    onSkip('only the Windows desktop shell hides its window to the tray')
    return () => {}
  }
  if (!process.connected) {
    onSkip('not the desktop Host child: no shell IPC channel')
    return () => {}
  }
  let ownerPids
  try {
    ownerPids = new Set(ancestorsOf(processTable(), process.pid).map(ancestor => ancestor.pid))
  } catch (error) {
    onSkip(`Win32 unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return () => {}
  }
  const imagePath = process.execPath
  let armed = false
  let invisibleTicks = 0
  let stopped = false
  const tick = () => {
    if (stopped) return
    let windows
    try {
      windows = appWindows(ownerPids, imagePath)
    } catch {
      return // a transient Win32 failure never counts as a close
    }
    if (windows.length === 0) return // nothing to observe yet
    if (windows.some(window => window.visible)) {
      armed = true
      invisibleTicks = 0
      return
    }
    if (!armed || ++invisibleTicks < confirmations) return
    stopped = true
    clearInterval(timer)
    onClosed(windows[0].pid)
  }
  const timer = setInterval(tick, intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
