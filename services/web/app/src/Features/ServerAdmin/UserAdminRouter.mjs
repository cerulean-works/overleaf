import AuthorizationMiddleware from '../Authorization/AuthorizationMiddleware.mjs'
import UserAdminController from './UserAdminController.mjs'
import { ensureActiveSiteAdmin } from './AdminApiMiddleware.mjs'

export default {
  apply(webRouter) {
    const admin = [
      ensureActiveSiteAdmin,
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
    ]
    webRouter.get('/admin/api/users', admin, UserAdminController.listUsers)
    webRouter.patch(
      '/admin/api/users/:userId',
      admin,
      UserAdminController.updateUser
    )
    webRouter.get(
      '/admin/api/invitations',
      admin,
      UserAdminController.listInvitations
    )
    webRouter.post(
      '/admin/api/invitations',
      admin,
      UserAdminController.createInvitations
    )
    webRouter.post(
      '/admin/api/invitations/:invitationId/resend',
      admin,
      UserAdminController.resendInvitation
    )
    webRouter.post(
      '/admin/api/invitations/:invitationId/revoke',
      admin,
      UserAdminController.revokeInvitation
    )
    webRouter.post(
      '/admin/api/invitations/:invitationId/link',
      admin,
      UserAdminController.invitationLink
    )
  },
}
