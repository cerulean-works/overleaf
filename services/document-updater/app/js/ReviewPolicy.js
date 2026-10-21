// Dependency-free policy shared by the locked review action and its tests.
function reviewError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

function selectChanges(allChanges, ids, ownOnly, userId) {
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    new Set(ids).size !== ids.length
  ) {
    throw reviewError(409, 'Select distinct current changes')
  }
  const byId = new Map(allChanges.map(change => [change.id, change]))
  const changes = ids.map(id => byId.get(id))
  if (changes.some(change => !change)) {
    throw reviewError(409, 'Changes have moved; refresh and try again')
  }
  if (ownOnly && changes.some(change => change.metadata?.user_id !== userId)) {
    throw reviewError(403, 'Reviewers can only reject their own changes')
  }
  return changes
}

function shareJsRejection(changes) {
  // Descending positions keep replacements and adjacent rejections stable.
  return [...changes]
    .sort(
      (a, b) => b.op.p - a.op.p || Number('d' in b.op) - Number('d' in a.op)
    )
    .map(({ op }) =>
      'i' in op ? { p: op.p, d: op.i, u: true } : { p: op.p, i: op.d, u: true }
    )
}

function assertProtectedChanges(before, after, userId) {
  // Positions can move under normal edits. Another author's suggestion must
  // retain its content and provenance; a client cannot turn an undo flag into
  // permission to reject somebody else's suggestion.
  const signatures = changes => {
    const groups = new Map()
    for (const change of [...changes].sort(
      (a, b) => (a.op.p ?? 0) - (b.op.p ?? 0)
    )) {
      if (change.metadata?.user_id === userId) continue
      const key = JSON.stringify([
        change.metadata?.user_id,
        new Date(change.metadata?.ts).toISOString(),
        'i' in change.op ? 'insert' : 'delete',
      ])
      // Inserting a new suggestion into an existing insertion legitimately
      // splits that insertion. Compare ordered content by provenance rather
      // than requiring its original segment boundaries to survive.
      groups.set(key, (groups.get(key) || '') + (change.op.i ?? change.op.d))
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }
  if (
    JSON.stringify(signatures(before)) !== JSON.stringify(signatures(after))
  ) {
    throw reviewError(
      403,
      "Reviewers cannot change another author's suggestions"
    )
  }
}

module.exports = {
  reviewError,
  selectChanges,
  shareJsRejection,
  assertProtectedChanges,
}
