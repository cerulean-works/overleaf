import { User } from '../../models/User.mjs'
import { SiteInvitation } from '../../models/SiteInvitation.mjs'
import LockManager from '../../infrastructure/LockManager.mjs'
import UserAuditLogHandler from '../User/UserAuditLogHandler.mjs'
import UserSessionsManager from '../User/UserSessionsManager.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SiteInvitationManager from './SiteInvitationManager.mjs'
import { UserAdminError } from './UserAdminErrors.mjs'

const USER_FIELDS = {
  email: 1,
  first_name: 1,
  last_name: 1,
  isAdmin: 1,
  suspended: 1,
  signUpDate: 1,
  lastLoggedIn: 1,
  siteInvitationPending: 1,
  holdingAccount: 1,
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function userDTO(user, invitation) {
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    isAdmin: !!user.isAdmin,
    suspended: !!user.suspended,
    signUpDate: user.signUpDate || null,
    lastLoggedIn: user.lastLoggedIn || null,
    invitationStatus: invitation
      ? SiteInvitationManager.status(invitation)
      : user.siteInvitationPending
        ? 'pending'
        : 'legacy',
  }
}

async function listUsers({ q, page, pageSize, role, suspended }) {
  const filter = {}
  if (q) {
    const search = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { email: search },
      { first_name: search },
      { last_name: search },
    ]
    if (/^[a-f\d]{24}$/i.test(q)) filter.$or.push({ _id: q })
  }
  if (role) filter.isAdmin = role === 'admin' ? true : { $ne: true }
  if (suspended !== undefined)
    filter.suspended = suspended ? true : { $ne: true }
  const [users, total] = await Promise.all([
    User.find(filter, USER_FIELDS)
      .sort({ signUpDate: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean()
      .exec(),
    User.countDocuments(filter).exec(),
  ])
  const invitations = await SiteInvitation.find({
    userId: { $in: users.map(user => user._id) },
  })
    .lean()
    .exec()
  const byUser = new Map(
    invitations.map(invitation => [invitation.userId.toString(), invitation])
  )
  return {
    items: users.map(user => userDTO(user, byUser.get(user._id.toString()))),
    total,
    page,
    pageSize,
  }
}

async function listInvitations({ q, page, pageSize }) {
  const filter = q ? { email: new RegExp(escapeRegex(q), 'i') } : {}
  const [invitations, total] = await Promise.all([
    SiteInvitation.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean()
      .exec(),
    SiteInvitation.countDocuments(filter).exec(),
  ])
  const inviters = await User.find(
    { _id: { $in: invitations.map(invitation => invitation.invitedBy) } },
    { email: 1 }
  )
    .lean()
    .exec()
  const byId = new Map(inviters.map(user => [user._id.toString(), user]))
  return {
    items: invitations.map(invitation =>
      SiteInvitationManager.toDTO(
        invitation,
        byId.get(invitation.invitedBy.toString())
      )
    ),
    total,
    page,
    pageSize,
  }
}

async function updateUser(userId, changes, auditLog) {
  // All admin availability changes share a lock, so two admins cannot each
  // remove the other after both observe an out-of-date admin count.
  const updated = await LockManager.promises.runWithLock(
    'site-admin-users',
    'roles',
    async () => {
      const actor = await User.findById(auditLog.initiatorId, USER_FIELDS)
        .lean()
        .exec()
      if (!actor?.isAdmin || actor.suspended || actor.siteInvitationPending)
        throw new UserAdminError('Administrator access required.', 403)
      const user = await User.findById(userId, USER_FIELDS).lean().exec()
      if (!user) throw new UserAdminError('User not found.', 404)
      if (
        user._id.toString() === actor._id.toString() &&
        (changes.isAdmin === false || changes.suspended === true)
      ) {
        throw new UserAdminError(
          'You cannot remove your own administrator access or suspend your own account.'
        )
      }
      if (
        changes.isAdmin &&
        (user.siteInvitationPending || user.holdingAccount)
      ) {
        throw new UserAdminError(
          'The user must accept their invitation before becoming an administrator.'
        )
      }
      const removesAvailableAdmin =
        user.isAdmin &&
        !user.suspended &&
        (changes.isAdmin === false || changes.suspended === true)
      if (removesAvailableAdmin) {
        const count = await User.countDocuments({
          isAdmin: true,
          suspended: { $ne: true },
          siteInvitationPending: { $ne: true },
          holdingAccount: { $ne: true },
        }).exec()
        if (count <= 1)
          throw new UserAdminError(
            'The last active administrator cannot be removed or suspended.'
          )
      }
      await UserAuditLogHandler.promises.addEntry(
        userId,
        'admin-user-permissions-changed',
        auditLog.initiatorId,
        auditLog.ip,
        {
          previous: { isAdmin: !!user.isAdmin, suspended: !!user.suspended },
          changes,
        }
      )
      await User.updateOne({ _id: userId }, { $set: changes }).exec()
      return { ...user, ...changes }
    }
  )
  try {
    await UserSessionsManager.promises.removeSessionsFromRedis({
      _id: updated._id,
    })
  } finally {
    // Existing editor sockets cache their privileges after joining. Deleting
    // the HTTP session alone does not revoke those live connections.
    await EditorRealTimeController.emitToAll('user:permissions:changed', {
      userId: updated._id.toString(),
    })
  }
  const invitation = await SiteInvitation.findOne({ userId }).lean().exec()
  return userDTO(updated, invitation)
}

export default { listUsers, listInvitations, updateUser }
