import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import { fetchJson, RequestFailedError } from '@overleaf/fetch-utils'
import {
  z,
  zz,
  parseReq,
} from '../../../../app/src/infrastructure/Validation.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import TokenAccessHandler from '../../../../app/src/Features/TokenAccess/TokenAccessHandler.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import CollaboratorsHandler from '../../../../app/src/Features/Collaborators/CollaboratorsHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { ForbiddenError } from '../../../../app/src/Features/Errors/Errors.js'
import { trackingUpdates } from './ReviewPolicy.mjs'

const params = z.object({
  project_id: zz.objectId(),
  doc_id: zz.objectId().optional(),
  thread_id: zz.objectId().optional(),
  message_id: zz.objectId().optional(),
})
const content = z.string().trim().min(1).max(10000)
const messageSchema = z.object({ params, body: z.strictObject({ content }) })
const paramsSchema = z.object({ params })
const trackingSchema = z.object({
  params,
  body: z.strictObject({
    on_for: z.record(zz.objectId(), z.boolean()).optional(),
    on_for_guests: z.boolean().optional(),
  }),
})
const changeSchema = z.object({
  params,
  body: z.strictObject({
    version: z.number().int().nonnegative(),
    change_ids: z.array(z.string().min(1).max(100)).min(1).max(2000).optional(),
    changes: z
      .array(
        z.strictObject({
          start: z.number().int().nonnegative(),
          length: z.number().int().positive(),
          type: z.enum(['insert', 'delete']),
          user_id: z.string(),
          ts: z.string(),
          content: z.string(),
        })
      )
      .min(1)
      .max(2000)
      .optional(),
  }),
})

function userId(req) {
  return SessionManager.getLoggedInUserId(req.session).toString()
}

async function personalInfo(id) {
  return UserInfoController.formatPersonalInfo(
    await UserInfoManager.promises.getPersonalInfo(id)
  )
}

function emit(projectId, event, ...payload) {
  return EditorRealTimeController.emitToRoom(projectId, event, ...payload)
}

async function ensureDoc(projectId, docId) {
  const project = await ProjectGetter.promises.getProject(projectId, {
    rootFolder: true,
  })
  await ProjectLocator.promises.findElement({
    project,
    element_id: docId,
    type: 'doc',
  })
}

async function getThreadAuthor(req, res) {
  const {
    params: { project_id: projectId, thread_id: threadId },
  } = parseReq(req, paramsSchema)
  const thread = await ChatApiHandler.promises.getThread(projectId, threadId)
  const author = thread.messages[0]?.user_id
  if (!author) return res.sendStatus(404)
  res.json({ user_id: author })
}

async function getThreads(req, res) {
  const {
    params: { project_id: projectId },
  } = parseReq(req, paramsSchema)
  const threads = await ChatApiHandler.promises.getThreads(projectId)
  await ChatManager.promises.injectUserInfoIntoThreads(threads)
  res.json(threads)
}

async function allProjectRanges(projectId) {
  const persisted = await DocstoreManager.promises.getAllRanges(projectId)
  const current =
    await DocumentUpdaterHandler.promises.getProjectRanges(projectId)
  const merged = new Map(
    persisted.map(doc => [
      String(doc._id),
      { id: String(doc._id), ranges: doc.ranges || {} },
    ])
  )
  for (const doc of current)
    merged.set(String(doc.id), {
      ...doc,
      id: String(doc.id),
      ranges: doc.ranges || {},
    })
  const project = await ProjectGetter.promises.getProject(projectId, {
    rootFolder: true,
  })
  const active = new Set()
  const visit = folder => {
    for (const doc of folder.docs || []) active.add(doc._id.toString())
    for (const child of folder.folders || []) visit(child)
  }
  visit(project.rootFolder[0])
  return [...merged.values()].filter(doc => active.has(doc.id))
}

async function getRanges(req, res) {
  const {
    params: { project_id: projectId },
  } = parseReq(req, paramsSchema)
  res.json(await allProjectRanges(projectId))
}

async function getChangesUsers(req, res) {
  const {
    params: { project_id: projectId },
  } = parseReq(req, paramsSchema)
  const docs = await allProjectRanges(projectId)
  const ids = new Set(
    docs
      .flatMap(doc =>
        (doc.ranges.changes || []).map(change => change.metadata?.user_id)
      )
      .filter(id => /^[a-f0-9]{24}$/i.test(id))
  )
  const users = await UserGetter.promises.getUsers([...ids], {
    _id: true,
    first_name: true,
    last_name: true,
    email: true,
  })
  res.json(users.map(UserInfoController.formatPersonalInfo))
}

async function setTracking(req, res) {
  const {
    params: { project_id: projectId },
    body,
  } = parseReq(req, trackingSchema)
  // Normalize old boolean records once using compare-and-swap. Preference
  // updates then use individual dotted paths, never a stale client-side map.
  const project = await ProjectGetter.promises.getProject(projectId, {
    track_changes: true,
  })
  if (!project.track_changes || typeof project.track_changes !== 'object') {
    const normalized =
      await CollaboratorsHandler.promises.convertTrackChangesToExplicitFormat(
        projectId,
        project.track_changes
      )
    await Project.updateOne(
      {
        _id: projectId,
        track_changes: project.track_changes ?? { $exists: false },
      },
      { $set: { track_changes: normalized } }
    ).exec()
  }
  const updates = trackingUpdates(body, userId(req))
  if (Object.keys(updates).length) {
    await Project.updateOne({ _id: projectId }, { $set: updates }).exec()
  }
  const latest = await ProjectGetter.promises.getProject(projectId, {
    track_changes: true,
  })
  await emit(projectId, 'toggle-track-changes', latest.track_changes || {})
  res.sendStatus(204)
}

async function sendMessage(req, res) {
  const {
    params: { project_id: projectId, thread_id: threadId },
    body,
  } = parseReq(req, messageSchema)
  const message = await ChatApiHandler.promises.sendComment(
    projectId,
    threadId,
    userId(req),
    body.content
  )
  message.user = await personalInfo(userId(req))
  await emit(projectId, 'new-comment', threadId, message)
  res.sendStatus(204)
}

async function requireMessageAuthor(req, projectId, threadId, messageId) {
  const message = await ChatApiHandler.promises.getThreadMessage(
    projectId,
    threadId,
    messageId
  )
  if (message.user_id !== userId(req))
    throw new ForbiddenError('only the message author can edit this message')
}

async function editMessage(req, res) {
  const {
    params: {
      project_id: projectId,
      thread_id: threadId,
      message_id: messageId,
    },
    body,
  } = parseReq(req, messageSchema)
  await requireMessageAuthor(req, projectId, threadId, messageId)
  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId(req),
    body.content
  )
  await emit(projectId, 'edit-message', threadId, messageId, body.content)
  res.sendStatus(204)
}

async function deleteMessage(req, res) {
  const {
    params: {
      project_id: projectId,
      thread_id: threadId,
      message_id: messageId,
    },
  } = parseReq(req, paramsSchema)
  const token = TokenAccessHandler.getRequestToken(req, projectId)
  const writer = await AuthorizationManager.promises.canUserWriteProjectContent(
    userId(req),
    projectId,
    token
  )
  if (!writer) await requireMessageAuthor(req, projectId, threadId, messageId)
  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)
  await emit(projectId, 'delete-message', threadId, messageId)
  res.sendStatus(204)
}

async function deleteOwnMessage(req, res) {
  const {
    params: {
      project_id: projectId,
      thread_id: threadId,
      message_id: messageId,
    },
  } = parseReq(req, paramsSchema)
  await requireMessageAuthor(req, projectId, threadId, messageId)
  await ChatApiHandler.promises.deleteUserMessage(
    projectId,
    threadId,
    userId(req),
    messageId
  )
  await emit(projectId, 'delete-message', threadId, messageId)
  res.sendStatus(204)
}

function threadAction(action) {
  return async (req, res) => {
    const {
      params: { project_id: projectId, doc_id: docId, thread_id: threadId },
    } = parseReq(req, paramsSchema)
    await ensureDoc(projectId, docId)
    try {
      await DocumentUpdaterHandler.promises.getComment(
        projectId,
        docId,
        threadId
      )
    } catch (error) {
      // A previous delete may have removed the anchor before the chat service
      // failed. Project membership and thread-level authorization still apply.
      if (
        !(
          action === 'delete' &&
          error instanceof RequestFailedError &&
          error.response?.status === 404
        )
      )
        throw error
    }
    // Apply the authoritative anchor first. Retrying this action repairs a
    // partial chat-service failure without losing either messages or anchors.
    if (action === 'delete') {
      // Document-updater deletion is idempotent when its anchor is absent.
      await DocumentUpdaterHandler.promises.deleteThread(
        projectId,
        docId,
        threadId,
        userId(req)
      )
      await ChatApiHandler.promises.deleteThread(projectId, threadId)
      await emit(projectId, 'delete-thread', threadId, docId)
    } else if (action === 'resolve') {
      await DocumentUpdaterHandler.promises.resolveThread(
        projectId,
        docId,
        threadId,
        userId(req)
      )
      await ChatApiHandler.promises.resolveThread(
        projectId,
        threadId,
        userId(req)
      )
      await emit(
        projectId,
        'resolve-thread',
        threadId,
        await personalInfo(userId(req))
      )
    } else {
      await DocumentUpdaterHandler.promises.reopenThread(
        projectId,
        docId,
        threadId,
        userId(req)
      )
      await ChatApiHandler.promises.reopenThread(projectId, threadId)
      await emit(projectId, 'reopen-thread', threadId)
    }
    await emit(projectId, 'project-review-updated')
    res.sendStatus(204)
  }
}

function decideChanges(action) {
  return async (req, res) => {
    const {
      params: { project_id: projectId, doc_id: docId },
      body,
    } = parseReq(req, changeSchema)
    await ensureDoc(projectId, docId)
    const privilege =
      await AuthorizationManager.promises.getPrivilegeLevelForProject(
        userId(req),
        projectId,
        TokenAccessHandler.getRequestToken(req, projectId),
        { ignorePublicAccess: true }
      )
    if (
      !['owner', 'readAndWrite', 'review'].includes(privilege) ||
      (action === 'accept' && privilege === 'review')
    ) {
      throw new ForbiddenError(
        'insufficient permissions for this review action'
      )
    }
    try {
      await fetchJson(
        `${Settings.apis.documentupdater.url}/project/${projectId}/doc/${docId}/review/${action}`,
        {
          method: 'POST',
          json: {
            ...body,
            user_id: userId(req),
            own_only: privilege === 'review',
          },
          signal: AbortSignal.timeout(30000),
        }
      )
    } catch (error) {
      const status =
        error instanceof RequestFailedError ? error.response?.status : undefined
      if ([403, 404, 409].includes(status)) return res.sendStatus(status)
      throw error
    }
    await emit(projectId, 'project-review-updated')
    if (action === 'accept' && body.change_ids)
      await emit(projectId, 'accept-changes', docId, body.change_ids)
    res.sendStatus(204)
  }
}

export default Object.fromEntries(
  Object.entries({
    getThreadAuthor,
    getThreads,
    getRanges,
    getChangesUsers,
    setTracking,
    sendMessage,
    editMessage,
    deleteMessage,
    deleteOwnMessage,
    resolve: threadAction('resolve'),
    reopen: threadAction('reopen'),
    deleteThread: threadAction('delete'),
    accept: decideChanges('accept'),
    reject: decideChanges('reject'),
  }).map(([key, handler]) => [key, expressify(handler)])
)
