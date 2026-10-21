import { expressify } from '@overleaf/promise-utils'
import { User } from '../../models/User.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'

// Apply first on JSON APIs so denied requests return 403 instead of following
// a login redirect to an HTML page. Follow with ensureUserIsSiteAdmin to retain
// configured admin-domain rules for valid administrators.
export const ensureActiveSiteAdmin = expressify(async (req, res, next) => {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId)
    return res.status(403).json({ message: 'Administrator access required.' })
  const user = await User.findById(userId, {
    isAdmin: 1,
    suspended: 1,
    siteInvitationPending: 1,
  })
    .lean()
    .exec()
  if (!user?.isAdmin || user.suspended || user.siteInvitationPending) {
    return res.status(403).json({ message: 'Administrator access required.' })
  }
  next()
})
