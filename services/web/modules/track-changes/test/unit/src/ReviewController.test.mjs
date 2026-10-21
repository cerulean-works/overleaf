import assert from 'node:assert/strict'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const projectId = 'a'.repeat(24)
const docId = 'b'.repeat(24)
const threadId = 'c'.repeat(24)
const messageId = 'd'.repeat(24)
const userId = 'e'.repeat(24)
const otherId = 'f'.repeat(24)
const source = name =>
  new URL(`../../../../../app/src/${name}`, import.meta.url).pathname

describe('CE review controller', () => {
  let controller,
    request,
    response,
    chat,
    updater,
    emit,
    auth,
    projectGetter,
    project,
    fetchJson,
    userGetter,
    invoke,
    RequestFailure
  beforeEach(async () => {
    vi.resetModules()
    chat = Object.fromEntries(
      [
        'getThreads',
        'sendComment',
        'getThreadMessage',
        'editMessage',
        'deleteMessage',
        'deleteUserMessage',
        'resolveThread',
        'reopenThread',
        'deleteThread',
      ].map(name => [name, vi.fn().mockResolvedValue(undefined)])
    )
    updater = Object.fromEntries(
      [
        'getProjectRanges',
        'getComment',
        'resolveThread',
        'reopenThread',
        'deleteThread',
      ].map(name => [name, vi.fn().mockResolvedValue(undefined)])
    )
    updater.getProjectRanges.mockResolvedValue([])
    chat.getThreadMessage.mockResolvedValue({ user_id: userId })
    emit = vi.fn().mockResolvedValue(undefined)
    auth = {
      canUserWriteProjectContent: vi.fn().mockResolvedValue(false),
      getPrivilegeLevelForProject: vi.fn().mockResolvedValue('readAndWrite'),
    }
    projectGetter = vi.fn().mockResolvedValue({
      _id: projectId,
      track_changes: {},
      rootFolder: [{ docs: [{ _id: docId }], folders: [] }],
    })
    project = {
      updateOne: vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(undefined) }),
    }
    fetchJson = vi.fn().mockResolvedValue({})
    userGetter = vi.fn().mockResolvedValue([])
    const mock = (name, value) =>
      vi.doMock(source(name), () => ({ default: value }))
    mock('Features/Authentication/SessionManager.mjs', {
      getLoggedInUserId: () => userId,
    })
    mock('Features/Authorization/AuthorizationManager.mjs', { promises: auth })
    mock('Features/TokenAccess/TokenAccessHandler.mjs', {
      getRequestToken: () => null,
    })
    mock('Features/Chat/ChatApiHandler.mjs', { promises: chat })
    mock('Features/Chat/ChatManager.mjs', {
      promises: {
        injectUserInfoIntoThreads: vi.fn().mockResolvedValue(undefined),
      },
    })
    mock('Features/DocumentUpdater/DocumentUpdaterHandler.mjs', {
      promises: updater,
    })
    mock('Features/Editor/EditorRealTimeController.mjs', { emitToRoom: emit })
    mock('Features/Project/ProjectGetter.mjs', {
      promises: { getProject: projectGetter },
    })
    mock('Features/Project/ProjectLocator.mjs', {
      promises: { findElement: vi.fn().mockResolvedValue({}) },
    })
    mock('Features/Collaborators/CollaboratorsHandler.mjs', {
      promises: {
        convertTrackChangesToExplicitFormat: vi.fn().mockResolvedValue({}),
      },
    })
    mock('Features/User/UserGetter.mjs', { promises: { getUsers: userGetter } })
    mock('Features/User/UserInfoManager.mjs', {
      promises: {
        getPersonalInfo: vi
          .fn()
          .mockResolvedValue({ _id: userId, first_name: 'Reviewer' }),
      },
    })
    mock('Features/User/UserInfoController.mjs', {
      formatPersonalInfo: user => ({
        id: String(user._id),
        first_name: user.first_name,
      }),
    })
    mock('Features/Docstore/DocstoreManager.mjs', {
      promises: {
        getAllRanges: vi.fn().mockResolvedValue([
          {
            _id: { toString: () => docId },
            ranges: { comments: [{ id: threadId }] },
          },
        ]),
      },
    })
    vi.doMock(source('models/Project.mjs'), () => ({ Project: project }))
    vi.doMock('@overleaf/settings', () => ({
      default: {
        apis: { documentupdater: { url: 'http://document-updater' } },
      },
    }))
    RequestFailure = class extends Error {}
    vi.doMock('@overleaf/fetch-utils', () => ({
      fetchJson,
      RequestFailedError: RequestFailure,
    }))
    controller = (await import('../../../app/src/ReviewController.mjs')).default
    request = {
      params: {
        project_id: projectId,
        doc_id: docId,
        thread_id: threadId,
        message_id: messageId,
      },
      body: {},
      session: {},
    }
    response = {
      json: vi.fn(),
      sendStatus: vi.fn(),
      status: vi.fn().mockReturnThis(),
    }
    invoke = async name => {
      let error
      await controller[name](request, response, failure => {
        error = failure
      })
      if (error) throw error
    }
  })

  it('merges persisted and live ranges by normalized doc id; live state wins', async () => {
    updater.getProjectRanges.mockResolvedValue([
      { id: docId, ranges: { comments: [] } },
      { id: otherId, ranges: { comments: [{ id: threadId }] } },
    ])
    await invoke('getRanges')
    expect(response.json).toHaveBeenCalledWith([
      { id: docId, ranges: { comments: [] } },
    ])
    updater.getProjectRanges.mockResolvedValue([])
    await invoke('getRanges')
    expect(response.json).toHaveBeenLastCalledWith([
      { id: docId, ranges: { comments: [{ id: threadId }] } },
    ])
  })

  it('persists only the requesting user tracking preference from a stale member map', async () => {
    request.body = { on_for: { [userId]: true, [otherId]: false } }
    await invoke('setTracking')
    expect(project.updateOne).toHaveBeenCalledWith(
      { _id: projectId },
      { $set: { [`track_changes.${userId}`]: true } }
    )
    expect(emit).toHaveBeenCalledWith(projectId, 'toggle-track-changes', {})
  })

  it('rejects malformed mode keys instead of putting Mongo field operators into a query', async () => {
    request.body = { on_for: { $where: true } }
    await assert.rejects(invoke('setTracking'))
    expect(project.updateOne).not.toHaveBeenCalled()
  })

  it('publishes a formatted comment and enforces nonempty bounded content', async () => {
    request.body = { content: ' A useful comment ' }
    chat.sendComment.mockResolvedValue({
      id: messageId,
      user_id: userId,
      timestamp: 1,
    })
    await invoke('sendMessage')
    expect(chat.sendComment).toHaveBeenCalledWith(
      projectId,
      threadId,
      userId,
      'A useful comment'
    )
    expect(emit).toHaveBeenCalledWith(
      projectId,
      'new-comment',
      threadId,
      expect.objectContaining({ user: { id: userId, first_name: 'Reviewer' } })
    )
    request.body = { content: ' ' }
    await assert.rejects(invoke('sendMessage'))
  })

  it('allows editing own messages and denies editing another author', async () => {
    request.body = { content: 'updated' }
    await invoke('editMessage')
    expect(chat.editMessage).toHaveBeenCalledWith(
      projectId,
      threadId,
      messageId,
      userId,
      'updated'
    )
    chat.editMessage.mockClear()
    chat.getThreadMessage.mockResolvedValue({ user_id: otherId })
    await assert.rejects(invoke('editMessage'), /message author/)
    expect(chat.editMessage).not.toHaveBeenCalled()
  })

  it('allows an author to delete their own message; other-message deletion requires write access', async () => {
    await invoke('deleteOwnMessage')
    expect(chat.deleteUserMessage).toHaveBeenCalledWith(
      projectId,
      threadId,
      userId,
      messageId
    )
    chat.getThreadMessage.mockResolvedValue({ user_id: otherId })
    await assert.rejects(invoke('deleteMessage'), /message author/)
    auth.canUserWriteProjectContent.mockResolvedValue(true)
    await invoke('deleteMessage')
    expect(chat.deleteMessage).toHaveBeenCalledWith(
      projectId,
      threadId,
      messageId
    )
  })

  it('updates both document and chat resolution state before broadcasting', async () => {
    await invoke('resolve')
    expect(updater.getComment).toHaveBeenCalledWith(projectId, docId, threadId)
    expect(updater.resolveThread).toHaveBeenCalledWith(
      projectId,
      docId,
      threadId,
      userId
    )
    expect(chat.resolveThread).toHaveBeenCalledWith(projectId, threadId, userId)
    expect(updater.resolveThread.mock.invocationCallOrder[0]).toBeLessThan(
      chat.resolveThread.mock.invocationCallOrder[0]
    )
    expect(emit).toHaveBeenCalledWith(projectId, 'resolve-thread', threadId, {
      id: userId,
      first_name: 'Reviewer',
    })
  })

  it('forwards only server-derived reviewer scope, rejecting reviewer acceptance and viewer mutations', async () => {
    request.body = { version: 7, change_ids: ['change-1'] }
    auth.getPrivilegeLevelForProject.mockResolvedValue('review')
    await invoke('reject')
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/review/reject'),
      expect.objectContaining({
        json: {
          version: 7,
          change_ids: ['change-1'],
          user_id: userId,
          own_only: true,
        },
      })
    )
    fetchJson.mockClear()
    await assert.rejects(invoke('accept'), /insufficient permissions/)
    auth.getPrivilegeLevelForProject.mockResolvedValue('readOnly')
    await assert.rejects(invoke('reject'), /insufficient permissions/)
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('repairs a partial thread deletion when a retry finds the anchor already absent', async () => {
    chat.deleteThread.mockRejectedValueOnce(new Error('chat unavailable'))
    await assert.rejects(invoke('deleteThread'), /chat unavailable/)
    const missing = new RequestFailure('anchor absent')
    missing.response = { status: 404 }
    updater.getComment.mockRejectedValueOnce(missing)
    await invoke('deleteThread')
    expect(chat.deleteThread).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledWith(
      projectId,
      'delete-thread',
      threadId,
      docId
    )
  })

  it('does not accept a client-supplied privilege override', async () => {
    request.body = { version: 7, change_ids: ['change-1'], own_only: false }
    await assert.rejects(invoke('reject'))
    expect(fetchJson).not.toHaveBeenCalled()
  })
})
