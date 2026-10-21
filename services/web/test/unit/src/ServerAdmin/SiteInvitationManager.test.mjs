import { beforeEach, describe, expect, it, vi } from 'vitest'

const ADMIN = '111111111111111111111111'
const USER = '222222222222222222222222'
const INVITATION = '333333333333333333333333'

function query(read) {
  const result = {
    lean: () => result,
    exec: async () => structuredClone(read()),
  }
  return result
}

describe('SiteInvitationManager', () => {
  beforeEach(async (ctx) => {
    ctx.users = new Map([[ADMIN, { _id: ADMIN, email: 'admin@example.com' }]])
    ctx.invitations = new Map()
    ctx.tokens = []
    const locks = new Map()
    ctx.lock = vi.fn(async (namespace, key, action) => {
      const name = `${namespace}:${key}`
      const previous = locks.get(name) || Promise.resolve()
      const current = previous.catch(() => {}).then(action)
      locks.set(name, current)
      return await current
    })
    ctx.User = {
      findById: vi.fn((id) =>
        query(() => ctx.users.get(id.toString()) || null)
      ),
      updateOne: vi.fn((filter, update) =>
        query(() => {
          const user = ctx.users.get(filter._id.toString())
          Object.assign(user, update.$set)
          for (const key of Object.keys(update.$unset || {})) delete user[key]
          return { matchedCount: 1 }
        })
      ),
    }
    ctx.SiteInvitation = {
      findOne: vi.fn((filter) =>
        query(
          () =>
            [...ctx.invitations.values()].find(
              (invitation) => invitation.userId === filter.userId
            ) || null
        )
      ),
      findById: vi.fn((id) => query(() => ctx.invitations.get(id) || null)),
      create: vi.fn(async (data) => {
        const invitation = { _id: INVITATION, ...data }
        ctx.invitations.set(INVITATION, structuredClone(invitation))
        return invitation
      }),
      updateOne: vi.fn((filter, update) =>
        query(() => {
          const invitation = ctx.invitations.get(filter._id)
          if (filter.generation && filter.generation !== invitation.generation)
            return { matchedCount: 0 }
          Object.assign(invitation, update.$set)
          for (const key of Object.keys(update.$unset || {}))
            delete invitation[key]
          return { matchedCount: 1 }
        })
      ),
    }
    ctx.creator = {
      promises: {
        createNewUser: vi.fn(async (data) => {
          const user = { _id: USER, ...data }
          ctx.users.set(USER, user)
          return user
        }),
      },
    }
    ctx.sendEmail = vi.fn().mockResolvedValue(undefined)
    ctx.audit = vi.fn().mockResolvedValue(undefined)
    vi.doMock('../../../../app/src/models/User.mjs', () => ({ User: ctx.User }))
    vi.doMock('../../../../app/src/models/SiteInvitation.mjs', () => ({
      SiteInvitation: ctx.SiteInvitation,
    }))
    vi.doMock('../../../../app/src/infrastructure/LockManager.mjs', () => ({
      default: { promises: { runWithLock: ctx.lock } },
    }))
    vi.doMock('../../../../app/src/Features/User/UserCreator.mjs', () => ({
      default: ctx.creator,
    }))
    vi.doMock('../../../../app/src/Features/User/UserGetter.mjs', () => ({
      default: {
        promises: {
          getUserByAnyEmail: async (email) =>
            [...ctx.users.values()].find((user) => user.email === email),
        },
      },
    }))
    vi.doMock(
      '../../../../app/src/Features/User/UserAuditLogHandler.mjs',
      () => ({ default: { promises: { addEntry: ctx.audit } } })
    )
    vi.doMock(
      '../../../../app/src/Features/Security/OneTimeTokenHandler.mjs',
      () => ({
        default: {
          promises: {
            getNewToken: vi.fn(async (use, data, options) => {
              ctx.tokens.push({ use, data, options })
              return `token-${ctx.tokens.length}`
            }),
          },
        },
      })
    )
    vi.doMock('../../../../app/src/Features/Email/EmailHandler.mjs', () => ({
      default: { promises: { sendEmail: ctx.sendEmail } },
    }))
    ctx.settings = {
      siteUrl: 'https://overleaf.example.com',
      email: { parameters: { host: 'smtp.example.com' } },
    }
    vi.doMock('@overleaf/settings', () => ({ default: ctx.settings }))
    ctx.manager = (
      await import('../../../../app/src/Features/ServerAdmin/SiteInvitationManager.mjs')
    ).default
    ctx.auditLog = { initiatorId: ADMIN, ip: '127.0.0.1' }
    ctx.create = () => ctx.manager.create('alice@example.com', ctx.auditLog)
  })

  it('provisions a fenced account, tracks the inviter and issues a seven-day dedicated token', async (ctx) => {
    const result = await ctx.create()
    expect(ctx.users.get(USER).siteInvitationPending).to.equal(true)
    expect(result.invitation.invitedBy).to.deep.equal({
      id: ADMIN,
      email: 'admin@example.com',
    })
    expect(result.invitation.status).to.equal('pending')
    expect(result.invitation.deliveryStatus).to.equal('sent')
    expect(ctx.tokens[0].use).to.equal('site-invitation')
    expect(ctx.tokens[0].options.expiresIn).to.equal(7 * 24 * 60 * 60)
    expect(result.url).to.include('/user/activate?token=token-1')
    expect(result.invitation).not.to.have.property('generation')
    expect(result.invitation).not.to.have.property('token')
  })

  it('records delivery failure without exposing the SMTP error or losing the invitation', async (ctx) => {
    ctx.sendEmail.mockRejectedValue(new Error('smtp password=private'))
    const result = await ctx.create()
    expect(result.invitation.deliveryStatus).to.equal('failed')
    expect(result.invitation.deliveryError).not.to.include('private')
    expect(result.invitation.status).to.equal('pending')
  })

  it('reports not_sent with no SMTP and does not log an activation URL through the mail fallback', async (ctx) => {
    delete ctx.settings.email
    const result = await ctx.create()
    expect(result.invitation.deliveryStatus).to.equal('not_sent')
    expect(result.invitation.lastSentAt).to.equal(null)
    expect(ctx.sendEmail).not.toHaveBeenCalled()
    const resent = await ctx.manager.resend(INVITATION, ctx.auditLog)
    expect(resent.deliveryStatus).to.equal('not_sent')
    expect(resent.lastSentAt).to.equal(null)
    expect(ctx.tokens).to.have.length(2)
    expect(ctx.sendEmail).not.toHaveBeenCalled()
  })

  it('rejects an established account without sending a password or invitation email', async (ctx) => {
    ctx.users.set(USER, {
      _id: USER,
      email: 'alice@example.com',
      holdingAccount: false,
    })
    await expect(ctx.create()).to.be.rejectedWith('already has an account')
    expect(ctx.sendEmail).not.toHaveBeenCalled()
  })

  it('recovers provisioning interrupted before the invitation record was created', async (ctx) => {
    ctx.users.set(USER, {
      _id: USER,
      email: 'alice@example.com',
      holdingAccount: false,
      siteInvitationPending: true,
    })
    await ctx.create()
    expect(ctx.creator.promises.createNewUser).not.toHaveBeenCalled()
    expect(ctx.invitations.size).to.equal(1)
  })

  it('blocks ordinary reset and pre-existing legacy tokens for pending invitations', async (ctx) => {
    await ctx.create()
    expect(await ctx.manager.canRequestPasswordReset(USER)).to.equal(false)
    expect(
      await ctx.manager.isPasswordResetAllowed(USER, {}, 'password')
    ).to.equal(false)
  })

  it('blocks reset while provisioning is incomplete, before an invitation row exists', async (ctx) => {
    ctx.users.set(USER, {
      _id: USER,
      email: 'alice@example.com',
      siteInvitationPending: true,
    })
    expect(await ctx.manager.canRequestPasswordReset(USER)).to.equal(false)
    expect(
      await ctx.manager.isPasswordResetAllowed(USER, {}, 'password')
    ).to.equal(false)
  })

  it('rotates tokens when resending or explicitly creating a manual link', async (ctx) => {
    await ctx.create()
    const first = ctx.tokens[0].data
    await ctx.manager.resend(INVITATION, ctx.auditLog)
    expect(
      await ctx.manager.isPasswordResetAllowed(USER, first, 'site-invitation')
    ).to.equal(false)
    const second = ctx.tokens[1].data
    const manual = await ctx.manager.link(INVITATION, ctx.auditLog)
    expect(
      await ctx.manager.isPasswordResetAllowed(USER, second, 'site-invitation')
    ).to.equal(false)
    expect(
      await ctx.manager.isPasswordResetAllowed(
        USER,
        ctx.tokens[2].data,
        'site-invitation'
      )
    ).to.equal(true)
    expect(manual.url).to.include('token-3')
    expect(ctx.sendEmail).toHaveBeenCalledTimes(2)
  })

  it('revokes invitation and legacy reset tokens without deleting the account', async (ctx) => {
    await ctx.create()
    const data = ctx.tokens[0].data
    await ctx.manager.revoke(INVITATION, ctx.auditLog)
    const action = vi.fn()
    expect(
      await ctx.manager.withPasswordResetAllowed(
        USER,
        data,
        'site-invitation',
        action
      )
    ).to.equal(null)
    expect(action).not.toHaveBeenCalled()
    expect(await ctx.manager.canRequestPasswordReset(USER)).to.equal(false)
    expect(ctx.users.has(USER)).to.equal(true)
  })

  it('marks acceptance only after successful password establishment and prevents invitation replay', async (ctx) => {
    await ctx.create()
    const data = ctx.tokens[0].data
    await ctx.manager.withPasswordResetAllowed(
      USER,
      data,
      'site-invitation',
      async () => ({ reset: false })
    )
    expect(ctx.invitations.get(INVITATION).status).to.equal('pending')
    await ctx.manager.withPasswordResetAllowed(
      USER,
      data,
      'site-invitation',
      async () => ({ reset: true })
    )
    expect(ctx.invitations.get(INVITATION).status).to.equal('accepted')
    expect(ctx.users.get(USER).siteInvitationPending).to.equal(undefined)
    expect(await ctx.manager.canRequestPasswordReset(USER)).to.equal(true)
    expect(
      await ctx.manager.withPasswordResetAllowed(
        USER,
        data,
        'site-invitation',
        vi.fn()
      )
    ).to.equal(null)
    await expect(
      ctx.manager.resend(INVITATION, ctx.auditLog)
    ).to.be.rejectedWith('already been accepted')
  })

  it('rejects expired invitation tokens while retaining the record', async (ctx) => {
    await ctx.create()
    ctx.invitations.get(INVITATION).expiresAt = new Date(Date.now() - 1000)
    expect(ctx.manager.status(ctx.invitations.get(INVITATION))).to.equal(
      'expired'
    )
    expect(
      await ctx.manager.isPasswordResetAllowed(
        USER,
        ctx.tokens[0].data,
        'site-invitation'
      )
    ).to.equal(false)
    expect(ctx.invitations.size).to.equal(1)
  })

  it('serializes activation and revocation against the same user', async (ctx) => {
    await ctx.create()
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    let started
    const running = new Promise((resolve) => {
      started = resolve
    })
    const activation = ctx.manager.withPasswordResetAllowed(
      USER,
      ctx.tokens[0].data,
      'site-invitation',
      async () => {
        started()
        await held
        return { reset: true }
      }
    )
    await running
    const revocation = ctx.manager.revoke(INVITATION, ctx.auditLog)
    release()
    await activation
    await expect(revocation).to.be.rejectedWith('already been accepted')
    expect(ctx.invitations.get(INVITATION).status).to.equal('accepted')
  })

  it('keeps legacy accounts compatible with password tokens', async (ctx) => {
    ctx.users.set(USER, { _id: USER, email: 'legacy@example.com' })
    expect(await ctx.manager.canRequestPasswordReset(USER)).to.equal(true)
    expect(
      await ctx.manager.isPasswordResetAllowed(USER, {}, 'password')
    ).to.equal(true)
    expect(
      await ctx.manager.isPasswordResetAllowed(USER, {}, 'site-invitation')
    ).to.equal(false)
  })
})
