import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import ReviewController from './ReviewController.mjs'

export default {
  apply(webRouter, privateApiRouter) {
    privateApiRouter.get(
      '/project/:project_id/thread/:thread_id/author',
      AuthenticationController.requirePrivateApiAuth(),
      ReviewController.getThreadAuthor
    )

    const read = [
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
    ]
    const base = '/project/:project_id'
    webRouter.get(`${base}/threads`, ...read, ReviewController.getThreads)
    webRouter.get(`${base}/ranges`, ...read, ReviewController.getRanges)
    webRouter.get(
      `${base}/changes/users`,
      ...read,
      ReviewController.getChangesUsers
    )
    webRouter.post(
      `${base}/track_changes`,
      ...read,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      ReviewController.setTracking
    )
    webRouter.post(
      `${base}/thread/:thread_id/messages`,
      ...read,
      ReviewController.sendMessage
    )
    webRouter.post(
      `${base}/thread/:thread_id/messages/:message_id/edit`,
      ...read,
      ReviewController.editMessage
    )
    webRouter.delete(
      `${base}/thread/:thread_id/messages/:message_id`,
      ...read,
      ReviewController.deleteMessage
    )
    webRouter.delete(
      `${base}/thread/:thread_id/own-messages/:message_id`,
      ...read,
      ReviewController.deleteOwnMessage
    )
    for (const action of ['resolve', 'reopen']) {
      webRouter.post(
        `${base}/doc/:doc_id/thread/:thread_id/${action}`,
        ...read,
        AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
        ReviewController[action]
      )
    }
    webRouter.delete(
      `${base}/doc/:doc_id/thread/:thread_id`,
      ...read,
      AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
      ReviewController.deleteThread
    )
    for (const action of ['accept', 'reject']) {
      webRouter.post(
        `${base}/doc/:doc_id/changes/${action}`,
        ...read,
        ReviewController[action]
      )
    }
  },
}
