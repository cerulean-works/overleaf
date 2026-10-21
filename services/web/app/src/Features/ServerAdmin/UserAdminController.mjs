import { expressify } from '@overleaf/promise-utils'
import { parseReq, z, zz } from '../../infrastructure/Validation.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import SiteInvitationManager from './SiteInvitationManager.mjs'
import UserAdminManager from './UserAdminManager.mjs'
import { UserAdminError } from './UserAdminErrors.mjs'
import logger from '@overleaf/logger'

const pagination = {
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}
const usersQuery = z.object({
  query: z.strictObject({
    ...pagination,
    role: z.enum(['admin', 'member']).optional(),
    suspended: z
      .enum(['true', 'false'])
      .transform(value => value === 'true')
      .optional(),
  }),
})
const invitationsQuery = z.object({ query: z.strictObject(pagination) })
const userPatch = z.object({
  params: z.object({ userId: zz.objectId() }),
  body: z
    .strictObject({
      isAdmin: z.boolean().optional(),
      suspended: z.boolean().optional(),
    })
    .refine(body => Object.keys(body).length > 0, {
      message: 'At least one change is required.',
    }),
})
const createInvitations = z.object({
  body: z.strictObject({
    emails: z.array(z.string().min(1).max(254)).min(1).max(100),
  }),
})
const invitationParams = z.object({
  params: z.object({ invitationId: zz.objectId() }),
  body: z.strictObject({}).optional(),
})

function auditLog(req) {
  return {
    initiatorId: SessionManager.getLoggedInUserId(req.session),
    ip: req.ip,
  }
}

function endpoint(handler) {
  return expressify(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof UserAdminError) {
        return res.status(error.statusCode).json({ message: error.message })
      }
      throw error
    }
  })
}

export default {
  listUsers: endpoint(async (req, res) => {
    const { query } = parseReq(req, usersQuery)
    res.json(await UserAdminManager.listUsers(query))
  }),
  updateUser: endpoint(async (req, res) => {
    const { params, body } = parseReq(req, userPatch)
    res.json(
      await UserAdminManager.updateUser(params.userId, body, auditLog(req))
    )
  }),
  listInvitations: endpoint(async (req, res) => {
    const { query } = parseReq(req, invitationsQuery)
    res.json(await UserAdminManager.listInvitations(query))
  }),
  createInvitations: endpoint(async (req, res) => {
    const { body } = parseReq(req, createInvitations)
    const results = []
    for (const email of [...new Set(body.emails)]) {
      try {
        const { invitation } = await SiteInvitationManager.create(
          email,
          auditLog(req)
        )
        results.push({ email, status: 'invited', invitation })
      } catch (error) {
        if (!(error instanceof UserAdminError)) {
          // Preserve completed per-email results without returning database or
          // mail-provider errors (which can include tokens or credentials).
          logger.error(
            { email, errorName: error.name },
            'Failed to create site invitation'
          )
        }
        results.push({
          email,
          status: 'error',
          error:
            error instanceof UserAdminError
              ? error.message
              : 'Could not create this invitation. Please retry or check the server logs.',
        })
      }
    }
    res.json({ results })
  }),
  resendInvitation: endpoint(async (req, res) => {
    const { params } = parseReq(req, invitationParams)
    res.json(
      await SiteInvitationManager.resend(params.invitationId, auditLog(req))
    )
  }),
  revokeInvitation: endpoint(async (req, res) => {
    const { params } = parseReq(req, invitationParams)
    res.json(
      await SiteInvitationManager.revoke(params.invitationId, auditLog(req))
    )
  }),
  invitationLink: endpoint(async (req, res) => {
    const { params } = parseReq(req, invitationParams)
    res.json(
      await SiteInvitationManager.link(params.invitationId, auditLog(req))
    )
  }),
}
