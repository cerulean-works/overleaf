const { reviewError } = require('./ReviewPolicy')

async function assertCommentAnchors(
  projectId,
  existingComments,
  update,
  threadIds
) {
  if (update.meta?.canEdit !== false || threadIds.length === 0) return
  const { user_id: userId, reviewer } = update.meta
  const existing = new Set(
    existingComments.map(comment => comment.id || comment.op?.t)
  )
  for (const id of new Set(threadIds)) {
    if (!reviewer && existing.has(id)) {
      throw reviewError(403, 'Viewers cannot replace existing comment anchors')
    }
    // History OT anchors do not store authors. Ask only for chat metadata;
    // this private route must never call document-updater while we hold its lock.
    const author =
      await require('./WebApiManager').promises.getCommentThreadAuthor(
        projectId,
        id
      )
    if (!userId || author !== userId) {
      throw reviewError(
        403,
        "Only writers can move another author's comment anchor"
      )
    }
  }
}

module.exports = { assertCommentAnchors }
