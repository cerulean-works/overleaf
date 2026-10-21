import crypto from 'node:crypto'
import settings from '@overleaf/settings'
import { SiteInvitation } from '../../models/SiteInvitation.mjs'
import { User } from '../../models/User.mjs'
import LockManager from '../../infrastructure/LockManager.mjs'
import UserCreator from '../User/UserCreator.mjs'
import UserGetter from '../User/UserGetter.mjs'
import UserAuditLogHandler from '../User/UserAuditLogHandler.mjs'
import OneTimeTokenHandler from '../Security/OneTimeTokenHandler.mjs'
import EmailHandler from '../Email/EmailHandler.mjs'
import EmailHelper from '../Helpers/EmailHelper.mjs'
import { UserAdminError } from './UserAdminErrors.mjs'

const TOKEN_USE = 'site-invitation'
const ONE_WEEK = 7 * 24 * 60 * 60
const LOCK_NAMESPACE = 'site-invitation'

function status(invitation) {
  if (
    invitation.status === 'pending' &&
    new Date(invitation.expiresAt).getTime() <= Date.now()
  ) {
    return 'expired'
  }
  return invitation.status
}

function toDTO(invitation, inviter) {
  return {
    id: invitation._id.toString(),
    email: invitation.email,
    userId: invitation.userId.toString(),
    invitedBy: inviter
      ? { id: inviter._id.toString(), email: inviter.email }
      : null,
    createdAt: invitation.createdAt,
    lastSentAt: invitation.lastSentAt || null,
    expiresAt: invitation.expiresAt,
    status: status(invitation),
    deliveryStatus: invitation.deliveryStatus,
    ...(invitation.deliveryError
      ? { deliveryError: invitation.deliveryError }
      : {}),
  }
}

async function audit(invitation, operation, auditLog) {
  await UserAuditLogHandler.promises.addEntry(
    invitation.userId,
    operation,
    auditLog.initiatorId,
    auditLog.ip,
    { invitationId: invitation._id.toString() }
  )
}

async function getDTO(invitation) {
  const inviter = await User.findById(invitation.invitedBy, { email: 1 })
    .lean()
    .exec()
  return toDTO(invitation, inviter)
}

async function generateLink(invitation) {
  const generation = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + ONE_WEEK * 1000)
  const token = await OneTimeTokenHandler.promises.getNewToken(
    TOKEN_USE,
    {
      user_id: invitation.userId.toString(),
      email: invitation.email,
      invitation_id: invitation._id.toString(),
      generation,
    },
    { expiresIn: ONE_WEEK }
  )
  // Generation fencing also invalidates old links if token cleanup is delayed.
  await SiteInvitation.updateOne(
    { _id: invitation._id },
    {
      $set: {
        generation,
        expiresAt,
        status: 'pending',
        deliveryStatus: 'not_sent',
      },
      $unset: { revokedAt: '', deliveryError: '' },
    }
  ).exec()
  Object.assign(invitation, {
    generation,
    expiresAt,
    status: 'pending',
    deliveryStatus: 'not_sent',
    deliveryError: undefined,
  })
  const query = new URLSearchParams({
    token,
    user_id: invitation.userId.toString(),
  })
  return `${settings.siteUrl}/user/activate?${query}`
}

async function deliver(invitation, url) {
  // EmailSender deliberately resolves after logging when no transport exists.
  // Skip that fallback: it neither delivers mail nor should log activation URLs.
  if (!settings.email?.parameters) return
  const lastSentAt = new Date()
  let deliveryStatus = 'sent'
  let deliveryError
  try {
    await EmailHandler.promises.sendEmail('registered', {
      to: invitation.email,
      setNewPasswordUrl: url,
    })
  } catch {
    // Do not expose SMTP responses, which can contain credentials or message URLs.
    deliveryStatus = 'failed'
    deliveryError =
      'Email delivery failed. Check the server mail configuration or copy a new invitation link.'
  }
  await SiteInvitation.updateOne(
    { _id: invitation._id, generation: invitation.generation },
    {
      $set: {
        lastSentAt,
        deliveryStatus,
        ...(deliveryError ? { deliveryError } : {}),
      },
    }
  ).exec()
  Object.assign(invitation, { lastSentAt, deliveryStatus, deliveryError })
}

async function create(email, auditLog) {
  email = EmailHelper.parseEmail(email)
  if (!email) throw new UserAdminError('Invalid email address.', 422)

  return await LockManager.promises.runWithLock(
    'site-invitation-create',
    email,
    async () => {
      const existing = await UserGetter.promises.getUserByAnyEmail(email)
      const previousInvitation = existing
        ? await SiteInvitation.findOne({ userId: existing._id }).lean().exec()
        : null
      if (
        existing &&
        !existing.holdingAccount &&
        (!existing.siteInvitationPending || previousInvitation)
      ) {
        throw new UserAdminError(
          'This email already has an account. Use the existing invitation actions or manage the user.'
        )
      }
      let user
      if (existing) {
        // Reuse a holding account created for project collaboration.
        await User.updateOne(
          { _id: existing._id },
          { $set: { holdingAccount: false, siteInvitationPending: true } }
        ).exec()
        user = existing
      } else {
        user = await UserCreator.promises.createNewUser(
          {
            email,
            holdingAccount: false,
            siteInvitationPending: true,
            analyticsId: crypto.randomUUID(),
          },
          {}
        )
      }
      return await LockManager.promises.runWithLock(
        LOCK_NAMESPACE,
        user._id.toString(),
        async () => {
          const invitation = await SiteInvitation.create({
            email,
            userId: user._id,
            invitedBy: auditLog.initiatorId,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + ONE_WEEK * 1000),
            status: 'pending',
            generation: crypto.randomUUID(),
            deliveryStatus: 'not_sent',
          })
          await audit(invitation, 'site-invitation-created', auditLog)
          const url = await generateLink(invitation)
          await deliver(invitation, url)
          return { invitation: await getDTO(invitation), url }
        }
      )
    }
  )
}

async function withInvitation(invitationId, action) {
  const initial = await SiteInvitation.findById(invitationId).lean().exec()
  if (!initial) throw new UserAdminError('Invitation not found.', 404)
  return await LockManager.promises.runWithLock(
    LOCK_NAMESPACE,
    initial.userId.toString(),
    async () => {
      const invitation = await SiteInvitation.findById(invitationId)
        .lean()
        .exec()
      if (!invitation) throw new UserAdminError('Invitation not found.', 404)
      if (invitation.status === 'accepted') {
        throw new UserAdminError('This invitation has already been accepted.')
      }
      return await action(invitation)
    }
  )
}

async function resend(invitationId, auditLog) {
  return await withInvitation(invitationId, async (invitation) => {
    await audit(invitation, 'site-invitation-resent', auditLog)
    const url = await generateLink(invitation)
    await deliver(invitation, url)
    return await getDTO(invitation)
  })
}

async function link(invitationId, auditLog) {
  return await withInvitation(invitationId, async (invitation) => {
    await audit(invitation, 'site-invitation-link-created', auditLog)
    const url = await generateLink(invitation)
    return { url, expiresAt: invitation.expiresAt }
  })
}

async function revoke(invitationId, auditLog) {
  return await withInvitation(invitationId, async (invitation) => {
    await audit(invitation, 'site-invitation-revoked', auditLog)
    await SiteInvitation.updateOne(
      { _id: invitation._id },
      {
        $set: {
          status: 'revoked',
          revokedAt: new Date(),
          generation: crypto.randomUUID(),
        },
      }
    ).exec()
    invitation.status = 'revoked'
    return await getDTO(invitation)
  })
}

function matchesToken(invitation, data, tokenUse) {
  if (!invitation) return tokenUse === 'password'
  if (invitation.status === 'accepted') return tokenUse === 'password'
  return (
    tokenUse === TOKEN_USE &&
    status(invitation) === 'pending' &&
    data?.invitation_id === invitation._id.toString() &&
    data?.generation === invitation.generation
  )
}

async function canRequestPasswordReset(userId) {
  const invitation = await SiteInvitation.findOne({ userId }).lean().exec()
  if (invitation) return invitation.status === 'accepted'
  const user = await User.findById(userId, { siteInvitationPending: 1 })
    .lean()
    .exec()
  return !user?.siteInvitationPending
}

async function isPasswordResetAllowed(userId, data, tokenUse) {
  const invitation = await SiteInvitation.findOne({ userId }).lean().exec()
  if (!invitation && !(await canRequestPasswordReset(userId))) return false
  return matchesToken(invitation, data, tokenUse)
}

// The same lock fences activation against resend/revoke and prevents concurrent
// requests from accepting the same invitation with different passwords.
async function withPasswordResetAllowed(userId, data, tokenUse, action) {
  return await LockManager.promises.runWithLock(
    LOCK_NAMESPACE,
    userId.toString(),
    async () => {
      const invitation = await SiteInvitation.findOne({ userId }).lean().exec()
      if (!invitation && !(await canRequestPasswordReset(userId))) return null
      if (!matchesToken(invitation, data, tokenUse)) return null
      const result = await action()
      if (result.reset && invitation && tokenUse === TOKEN_USE) {
        const accepted = await SiteInvitation.updateOne(
          {
            _id: invitation._id,
            generation: invitation.generation,
            status: 'pending',
          },
          { $set: { status: 'accepted', acceptedAt: new Date() } }
        ).exec()
        if (accepted.matchedCount !== 1) {
          throw new UserAdminError(
            'The invitation changed while the password was being set. Request a new invitation link.'
          )
        }
        await User.updateOne(
          { _id: userId },
          { $unset: { siteInvitationPending: '' } }
        ).exec()
      }
      return result
    }
  )
}

export default {
  TOKEN_USE,
  status,
  toDTO,
  create,
  resend,
  revoke,
  link,
  canRequestPasswordReset,
  isPasswordResetAllowed,
  withPasswordResetAllowed,
}
