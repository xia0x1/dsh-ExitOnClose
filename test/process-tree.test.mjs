import assert from 'node:assert/strict'
import test from 'node:test'
import { ancestorsOf, treeOf } from '../src/process-tree.js'

/**
 * A tree plus one process whose parent is not listed:
 *
 *   10 -> 20 -> 30
 *   20 -> 40
 *   50          (parent 999 is gone)
 */
const table = [
  { pid: 10, ppid: 1 },
  { pid: 20, ppid: 10 },
  { pid: 30, ppid: 20 },
  { pid: 40, ppid: 20 },
  { pid: 50, ppid: 999 },
]

const orderless = pids => [...pids].sort((left, right) => left - right)

test('ancestorsOf walks outward, nearest first', () => {
  assert.deepEqual(ancestorsOf(table, 30).map(row => row.pid), [20, 10])
})

test('ancestorsOf stops at a parent that is not in the table', () => {
  assert.deepEqual(ancestorsOf(table, 50).map(row => row.pid), [])
})

test('ancestorsOf excludes the process itself', () => {
  assert.deepEqual(ancestorsOf(table, 10).map(row => row.pid), [])
})

test('ancestorsOf survives a cycle', () => {
  const cyclic = [
    { pid: 1, ppid: 2 },
    { pid: 2, ppid: 1 },
  ]
  assert.deepEqual(ancestorsOf(cyclic, 1).map(row => row.pid), [2])
})

test('treeOf lists the root first and every descendant after it', () => {
  assert.deepEqual(treeOf(table, 10), [10, 20, 30, 40])
})

test('treeOf finds descendants whose parent appears later in the table', () => {
  assert.deepEqual(orderless(treeOf([...table].reverse(), 10)), [10, 20, 30, 40])
})

test('treeOf leaves an unrelated process out', () => {
  assert.deepEqual(treeOf(table, 10).includes(50), false)
})

test('treeOf of a leaf is the leaf alone', () => {
  assert.deepEqual(treeOf(table, 30), [30])
})
