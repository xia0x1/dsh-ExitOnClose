/**
 * Process relationships, kept free of Win32 and Node APIs so the rules can be
 * read and unit tested on any platform.
 */

/**
 * Every strict ancestor of `pid`, innermost first. A missing parent ends the
 * walk, and a cycle can never loop forever.
 *
 * @param table - rows of `{ pid, ppid }`, e.g. one toolhelp snapshot.
 * @param pid - process to start from.
 * @returns ancestor rows, nearest first.
 */
export function ancestorsOf(table, pid) {
  const byPid = new Map(table.map(row => [row.pid, row]))
  const seen = new Set([pid])
  const chain = []
  for (let row = byPid.get(pid); row !== undefined && !seen.has(row.ppid); row = byPid.get(row.ppid)) {
    seen.add(row.ppid)
    const parent = byPid.get(row.ppid)
    if (parent === undefined) break
    chain.push(parent)
  }
  return chain
}

/**
 * `pid` and all of its descendants, breadth first. A parent listed after its
 * child is still walked, because the table is consumed as a whole.
 *
 * @param table - rows of `{ pid, ppid }`.
 * @param pid - root process.
 * @returns root first, then descendants.
 */
export function treeOf(table, pid) {
  const children = new Map()
  for (const row of table) {
    const list = children.get(row.ppid)
    if (list === undefined) children.set(row.ppid, [row.pid])
    else list.push(row.pid)
  }
  const tree = [pid]
  for (let index = 0; index < tree.length; index++) {
    for (const child of children.get(tree[index]) ?? []) tree.push(child)
  }
  return tree
}
