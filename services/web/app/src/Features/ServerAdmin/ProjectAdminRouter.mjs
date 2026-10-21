import { ensureActiveSiteAdmin } from './AdminApiMiddleware.mjs'
import ProjectAdminController from './ProjectAdminController.mjs'
import AuthorizationMiddleware from '../Authorization/AuthorizationMiddleware.mjs'
import CollaboratorsController from '../Collaborators/CollaboratorsController.mjs'
import CollaboratorsInviteController from '../Collaborators/CollaboratorsInviteController.mjs'

export default {
  apply(webRouter) {
    const admin = [
      ensureActiveSiteAdmin,
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
    ]
    const projectAdmin = AuthorizationMiddleware.ensureUserCanAdminProject
    webRouter.get('/admin/project', ...admin, (req, res) =>
      res.redirect('/admin#projects')
    )
    webRouter.get('/admin/api/projects', ...admin, ProjectAdminController.list)
    webRouter.get(
      '/admin/api/projects/:Project_id',
      ...admin,
      ProjectAdminController.details
    )
    webRouter.put(
      '/admin/api/projects/:Project_id/users/:user_id',
      ...admin,
      projectAdmin,
      CollaboratorsController.setCollaboratorInfo
    )
    webRouter.delete(
      '/admin/api/projects/:Project_id/users/:user_id',
      ...admin,
      projectAdmin,
      CollaboratorsController.removeUserFromProject
    )
    webRouter.post(
      '/admin/api/projects/:Project_id/invite',
      ...admin,
      projectAdmin,
      CollaboratorsInviteController.inviteToProject
    )
    webRouter.delete(
      '/admin/api/projects/:Project_id/invite/:invite_id',
      ...admin,
      projectAdmin,
      CollaboratorsInviteController.revokeInvite
    )
    webRouter.post(
      '/admin/api/projects/:Project_id/invite/:invite_id/resend',
      ...admin,
      projectAdmin,
      CollaboratorsInviteController.generateNewInvite
    )
  },
}
