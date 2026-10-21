// @ts-check
const Settings = require('@overleaf/settings')
const { fetchNothing, fetchJson } = require('@overleaf/fetch-utils')

const MAX_HTTP_REQUEST_LENGTH = 5000

/**
 * @param {string} projectId
 * @param {string} docId
 * @param {string[]} rejectedChangeAuthorIds
 * @param {string | undefined} userId
 * @param {object[]} [previews] sparse change previews from TrackedChangePreview.buildSparseChangePreviews
 */
async function notifyTrackChangesRejected(
  projectId,
  docId,
  rejectedChangeAuthorIds,
  userId,
  previews
) {
  const url = new URL(
    `/project/${projectId}/doc/${docId}/changes/reject`,
    Settings.apis.web.url
  )

  await fetchNothing(url, {
    method: 'POST',
    json: {
      rejectedChangeAuthorIds,
      userId,
      previews,
    },
    basicAuth: {
      user: Settings.apis.web.user,
      password: Settings.apis.web.pass,
    },
    signal: AbortSignal.timeout(MAX_HTTP_REQUEST_LENGTH),
  })
}

async function getCommentThreadAuthor(projectId, threadId) {
  const result = await fetchJson(
    new URL(
      `/project/${projectId}/thread/${threadId}/author`,
      Settings.apis.web.url
    ),
    {
      basicAuth: {
        user: Settings.apis.web.user,
        password: Settings.apis.web.pass,
      },
      signal: AbortSignal.timeout(MAX_HTTP_REQUEST_LENGTH),
    }
  )
  return result.user_id
}

module.exports = {
  promises: {
    notifyTrackChangesRejected,
    getCommentThreadAuthor,
  },
}
