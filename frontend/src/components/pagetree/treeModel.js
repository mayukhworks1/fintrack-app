// Pure helpers for the pages tree: grouping a flat node list by parent, and
// working out where a drop lands. Kept free of React so they are easy to test.

const ROOT = '__root__'
const keyOf = (parentId) => parentId || ROOT

const byPosition = (a, b) => {
  const pa = a.position ?? Infinity
  const pb = b.position ?? Infinity
  if (pa !== pb) return pa < pb ? -1 : 1
  return (a.title || '').localeCompare(b.title || '')
}

/** { byId: Map, childrenOf(parentId|null) -> ordered nodes } */
export function buildTree(nodes = []) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const groups = new Map()
  for (const n of nodes) {
    // A parent the server did not send (out of sight, or trashed) shows the
    // page at the top level rather than losing it.
    const parent = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null
    const k = keyOf(parent)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(n)
  }
  for (const list of groups.values()) list.sort(byPosition)
  return {
    byId,
    childrenOf: (parentId) => groups.get(keyOf(parentId)) || [],
    parentOf: (id) => {
      const n = byId.get(id)
      return n && n.parent_id && byId.has(n.parent_id) ? n.parent_id : null
    },
  }
}

/** Every id under `id` (not including it). */
export function descendantIds(tree, id) {
  const out = new Set()
  const stack = [id]
  while (stack.length) {
    for (const c of tree.childrenOf(stack.pop())) {
      if (!out.has(c.id)) { out.add(c.id); stack.push(c.id) }
    }
  }
  return out
}

/** Ancestor ids of `id`, nearest first. */
export function ancestorIds(tree, id) {
  const out = []
  const seen = new Set([id])
  let cur = tree.parentOf(id)
  while (cur && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = tree.parentOf(cur) }
  return out
}

/**
 * Where dropping `dragId` on `overId` puts it.
 * zone: 'before' | 'after' | 'inside'. Returns { parent_id, index } — index
 * counted among the new siblings without the dragged page — or null when the
 * drop is not allowed (onto itself or into its own sub-pages).
 */
export function dropPlacement(tree, dragId, overId, zone) {
  if (!dragId || !overId || dragId === overId) return null
  if (descendantIds(tree, dragId).has(overId)) return null
  if (zone === 'inside') {
    const kids = tree.childrenOf(overId).filter(n => n.id !== dragId)
    return { parent_id: overId, index: kids.length }
  }
  const parent = tree.parentOf(overId)
  const siblings = tree.childrenOf(parent).filter(n => n.id !== dragId)
  const at = siblings.findIndex(n => n.id === overId)
  if (at < 0) return null
  return { parent_id: parent, index: zone === 'after' ? at + 1 : at }
}

/** Depth-first list of { node, depth } for pickers. */
export function flatten(tree, parentId = null, depth = 0, out = []) {
  for (const n of tree.childrenOf(parentId)) {
    out.push({ node: n, depth })
    flatten(tree, n.id, depth + 1, out)
  }
  return out
}
