/**
 * dsh-ExitOnClose — Host half.
 *
 * DeepSeek Harness Desktop answers the window close button by hiding the window
 * in the system tray, with no setting to change it. This plugin makes that
 * button end the application instead: it watches the shell's window from the
 * Host child process (`src/desktop.js`) and, when the window that was on screen
 * goes invisible, terminates the shell and its whole process tree.
 *
 * Compatibility is deliberate and minimal:
 * - no DSH service is injected or consumed, no tool, slot or service is
 *   registered, and nothing shared is patched, so no other plugin can be
 *   affected by ordering, name or version;
 * - the entry declares no `@deepseek-ai/dsh*` peer dependency, so no DSH
 *   version gate can refuse to install or start it;
 * - `apply` never throws and never awaits: `koffi` is imported lazily, and a
 *   Host that cannot provide it simply stays inert instead of failing a boot;
 * - the only dependency is a prebuilt FFI package, so installation runs no
 *   build script and needs no approval.
 */

/** Diagnostic name shown by the Loader and in logs. */
export const name = 'dsh-exit-on-close'

/** Report what the close button would do without ending anything. */
const DRY_RUN = /^(?:1|true|yes)$/iu.test(process.env.DSH_EXIT_ON_CLOSE_DRY_RUN ?? '')

/**
 * Logger for this plugin. `ctx.logger` is callable with a name and also usable
 * directly; both shapes are accepted so a naming change cannot fail a mount.
 * @param ctx - plugin context.
 */
function loggerOf(ctx) {
  try {
    const scoped = ctx.logger(name)
    if (typeof scoped?.info === 'function') return scoped
  } catch {
    // fall through to the unscoped logger
  }
  return ctx.logger
}

/**
 * Mount the watch.
 * @param ctx - plugin context; every registration is fiber-scoped.
 */
export function apply(ctx) {
  const logger = loggerOf(ctx)
  let stop = () => {}
  let disposed = false
  // Registered before the import so disposal is correct even if the plugin is
  // removed, or the profile reloads, while the module is still loading.
  ctx.effect(() => () => {
    disposed = true
    stop()
  })

  import('./desktop.js').then(({ watchForClose, terminateApplication }) => {
    const disposer = watchForClose({
      onSkip: reason => logger.info('inactive: %s', reason),
      onClosed: (shellPid) => {
        if (DRY_RUN) {
          logger.info('dry run: the window was hidden; %d and its process tree would end', shellPid)
          return
        }
        logger.info('close button: ending the desktop application (shell %d)', shellPid)
        logger.info('terminated %d processes', terminateApplication(shellPid))
        process.exit(0)
      },
    })
    if (disposed) disposer()
    else stop = disposer
  }).catch((error) => {
    logger.warn('inactive: cannot load the Win32 layer: %s', error instanceof Error ? error.message : String(error))
  })
}
