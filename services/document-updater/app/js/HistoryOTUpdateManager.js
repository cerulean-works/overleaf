// @ts-check

const Profiler = require('./Profiler')
const DocumentManager = require('./DocumentManager')
const Errors = require('./Errors')
const RedisManager = require('./RedisManager')
const {
  EditOperationBuilder,
  StringFileData,
  AddCommentOperation,
  EditOperationTransformer,
} = require('overleaf-editor-core')
const Metrics = require('./Metrics')
const ProjectHistoryRedisManager = require('./ProjectHistoryRedisManager')
const HistoryManager = require('./HistoryManager')
const RealTimeRedisManager = require('./RealTimeRedisManager')

/**
 * @typedef {import("./types").Update} Update
 * @typedef {import("./types").HistoryOTEditOperationUpdate} HistoryOTEditOperationUpdate
 */

/**
 * @param {Update} update
 * @return {update is HistoryOTEditOperationUpdate}
 */
function isHistoryOTEditOperationUpdate(update) {
  return (
    update &&
    'doc' in update &&
    'op' in update &&
    'v' in update &&
    Array.isArray(update.op) &&
    update.op.length > 0 &&
    update.op.every(op => EditOperationBuilder.isValid(op))
  )
}

/**
 * Try to apply an update to the given document
 *
 * @param {string} projectId
 * @param {string} docId
 * @param {HistoryOTEditOperationUpdate} update
 * @param {Profiler} profiler
 */
async function tryApplyUpdate(projectId, docId, update, profiler) {
  let { lines, version, pathname, type } =
    await DocumentManager.promises.getDoc(projectId, docId)
  profiler.log('getDoc')

  if (lines == null || version == null) {
    throw new Errors.NotFoundError(`document not found: ${docId}`)
  }
  if (type !== 'history-ot') {
    throw new Errors.OTTypeMismatchError(type, 'history-ot')
  }

  // An update carries a list of sequential ops (e.g. a text edit composed
  // with a comment op). Keep the sequential apply in step with the frontend's
  // historyOTType.apply and HistoryOTAdapter.onRemoteOp.
  let ops = update.op.map(EditOperationBuilder.fromJSON)
  if (version !== update.v) {
    const transformUpdates = await RedisManager.promises.getPreviousDocOps(
      docId,
      update.v,
      version
    )
    for (const transformUpdate of transformUpdates) {
      if (!isHistoryOTEditOperationUpdate(transformUpdate)) {
        throw new Errors.OTTypeMismatchError('sharejs-text-ot', 'history-ot')
      }

      if (
        transformUpdate.meta.source &&
        update.dupIfSource?.includes(transformUpdate.meta.source)
      ) {
        update.dup = true
        break
      }

      // Rebase our ops onto the concurrent update.
      const transformOps = transformUpdate.op.map(EditOperationBuilder.fromJSON)
      EditOperationTransformer.transformMultiple(ops, transformOps)
    }
    update.op = ops.map(op => op.toJSON())
  }

  if (!update.dup) {
    const file = StringFileData.fromRaw(lines)
    await require('./CommentAuthorization').assertCommentAnchors(
      projectId,
      file.getComments().toArray(),
      update,
      ops
        .filter(op => 'commentId' in op && 'ranges' in op)
        .map(op => op.commentId)
    )
    const describe = value =>
      value
        .getTrackedChanges()
        .asSorted()
        .map(change => ({
          metadata: { user_id: change.tracking.userId, ts: change.tracking.ts },
          op:
            change.tracking.type === 'insert'
              ? {
                  p: change.range.start,
                  i: value
                    .getContent()
                    .slice(change.range.start, change.range.end),
                }
              : {
                  p: change.range.start,
                  d: value
                    .getContent()
                    .slice(change.range.start, change.range.end),
                },
        }))
    const protectedBefore = update.meta.reviewer ? describe(file) : null
    if (update.meta.reviewer) {
      for (const raw of update.op) {
        if (!('textOperation' in raw)) continue
        for (const scan of raw.textOperation) {
          if (
            typeof scan === 'object' &&
            'tracking' in scan &&
            scan.tracking &&
            (!('userId' in scan.tracking) ||
              scan.tracking.userId !== update.meta.user_id)
          ) {
            throw new Error('Reviewer cannot forge tracked change authorship')
          }
        }
      }
    }
    for (const [index, op] of ops.entries()) {
      let authorizedOp = op
      if (update.meta.canEdit === false && op instanceof AddCommentOperation) {
        // Adding/moving an anchor must not be a back door to resolving or
        // reopening a thread. Those actions use the authorized web endpoint.
        authorizedOp = new AddCommentOperation(
          op.commentId,
          op.ranges,
          file.getComments().getComment(op.commentId)?.resolved ?? false
        )
      }
      file.edit(authorizedOp)
      ops[index] = authorizedOp
    }
    update.op = ops.map(op => op.toJSON())
    if (protectedBefore) {
      require('./ReviewPolicy').assertProtectedChanges(
        protectedBefore,
        describe(file),
        update.meta.user_id
      )
    }
    version += 1
    update.meta.ts = Date.now()
    await RedisManager.promises.updateDocument(
      projectId,
      docId,
      file.toRaw(),
      version,
      [update],
      {},
      update.meta
    )

    Metrics.inc('history-queue', 1, { status: 'project-history' })
    try {
      const projectOpsLength =
        await ProjectHistoryRedisManager.promises.queueOps(projectId, [
          JSON.stringify({
            ...update,
            meta: {
              ...update.meta,
              pathname,
            },
          }),
        ])
      HistoryManager.recordAndFlushHistoryOps(
        projectId,
        [update],
        projectOpsLength
      )
      profiler.log('recordAndFlushHistoryOps')
    } catch (err) {
      // The full project history can re-sync a project in case
      //  updates went missing.
      // Just record the error here and acknowledge the write-op.
      Metrics.inc('history-queue-error')
    }
    await RedisManager.promises.recordProjectNotificationTimestamp(
      projectId,
      update.meta.ts
    )
    profiler.log('recordProjectNotificationTimestamp')
  }
  RealTimeRedisManager.sendData({
    project_id: projectId,
    doc_id: docId,
    op: update,
  })
}

/**
 * Apply an update to the given document
 *
 * @param {string} projectId
 * @param {string} docId
 * @param {HistoryOTEditOperationUpdate} update
 */
async function applyUpdate(projectId, docId, update) {
  const profiler = new Profiler('applyUpdate', {
    project_id: projectId,
    doc_id: docId,
    type: 'history-ot',
  })

  try {
    await tryApplyUpdate(projectId, docId, update, profiler)
  } catch (error) {
    RealTimeRedisManager.sendData({
      project_id: projectId,
      doc_id: docId,
      error: error instanceof Error ? error.message : String(error),
    })
    profiler.log('sendData')
    throw error
  } finally {
    profiler.end()
  }
}

module.exports = { isHistoryOTEditOperationUpdate, applyUpdate }
