const DocumentManager = require('./DocumentManager')
const {
  reviewError,
  selectChanges,
  shareJsRejection,
} = require('./ReviewPolicy')
const { StringFileData, TextOperation } = require('overleaf-editor-core')
const ClearTrackingProps = require('overleaf-editor-core/lib/file_data/clear_tracking_props')

async function decide(projectId, docId, action, request) {
  const UpdateManager = require('./UpdateManager')
  return UpdateManager.promises.lockUpdatesAndDo(
    decideUnderLock,
    projectId,
    docId,
    action,
    request
  )
}

async function decideUnderLock(projectId, docId, action, request) {
  const UpdateManager = require('./UpdateManager')
  const doc = await DocumentManager.promises.getDoc(projectId, docId)
  if (doc.version !== request.version) {
    throw reviewError(
      409,
      'Document changed; wait for synchronization and try again'
    )
  }
  if (request.own_only && action !== 'reject') {
    throw reviewError(403, 'Reviewers cannot accept suggestions')
  }
  if (doc.type === 'history-ot') {
    const file = StringFileData.fromRaw(doc.lines)
    const content = file.getContent()
    const candidates = file.getTrackedChanges().asSorted()
    const wanted = request.changes
    if (!wanted?.length || request.change_ids)
      throw reviewError(409, 'Expected snapshot changes')
    const selected = wanted.map(selector =>
      candidates.find(
        change =>
          change.range.start === selector.start &&
          change.range.length === selector.length &&
          change.tracking.type === selector.type &&
          change.tracking.userId === selector.user_id &&
          change.tracking.ts.toISOString() === selector.ts &&
          content.slice(change.range.start, change.range.end) ===
            selector.content
      )
    )
    if (
      selected.some(change => !change) ||
      new Set(selected).size !== selected.length
    ) {
      throw reviewError(409, 'Suggestions changed; refresh and try again')
    }
    if (
      request.own_only &&
      selected.some(change => change.tracking.userId !== request.user_id)
    ) {
      throw reviewError(403, 'Reviewers can only reject their own changes')
    }
    selected.sort((a, b) => a.range.start - b.range.start)
    const op = new TextOperation()
    let cursor = 0
    for (const change of selected) {
      const { range, tracking } = change
      if (range.start < cursor)
        throw reviewError(409, 'Overlapping suggestions')
      if (range.start > cursor) op.retain(range.start - cursor)
      const remove = (action === 'accept') === (tracking.type === 'delete')
      if (remove) op.remove(range.length)
      else
        op.retain({ r: range.length }, { tracking: new ClearTrackingProps() })
      cursor = range.end
    }
    if (cursor < file.getStringLength())
      op.retain(file.getStringLength() - cursor)
    await require('./HistoryOTUpdateManager').applyUpdate(projectId, docId, {
      doc: docId,
      v: doc.version,
      op: [op.toJSON()],
      meta: { user_id: request.user_id, source: `review:${action}` },
    })
  } else {
    if (request.changes) throw reviewError(409, 'Expected legacy change ids')
    const selected = selectChanges(
      doc.ranges?.changes || [],
      request.change_ids,
      request.own_only,
      request.user_id
    )
    if (action === 'accept') {
      await DocumentManager.promises.acceptChanges(
        projectId,
        docId,
        selected.map(change => change.id)
      )
    } else {
      await UpdateManager.promises.applyUpdate(projectId, docId, {
        doc: docId,
        v: doc.version,
        op: shareJsRejection(selected),
        meta: { user_id: request.user_id, source: 'review:reject' },
      })
    }
  }
}

module.exports = { decide, decideUnderLock }
