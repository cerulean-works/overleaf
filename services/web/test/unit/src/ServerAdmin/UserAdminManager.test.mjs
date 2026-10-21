import { beforeEach, describe, expect, it, vi } from 'vitest'

const ADMIN = '111111111111111111111111'
const OTHER_ADMIN = '222222222222222222222222'
const MEMBER = '333333333333333333333333'

function query(read) {
  const result = {
    lean: () => result,
    sort: () => result,
    skip: () => result,
    limit: () => result,
    exec: async () => structuredClone(read()),
  }
  return result
}

describe('UserAdminManager', () => {
  beforeEach(async ctx => {
    ctx.users = new Map([
      [ADMIN, { _id: ADMIN, email: 'admin@example.com', isAdmin: true }],
      [
        OTHER_ADMIN,
        { _id: OTHER_ADMIN, email: 'other@example.com', isAdmin: true },
      ],
      [
        MEMBER,
        {
          _id: MEMBER,
          email: 'member@example.com',
          isAdmin: false,
          hashedPassword: 'private',
          overleaf: { accessToken: 'private' },
        },
      ],
    ])
    ctx.User = {
      findById: vi.fn(id => query(() => ctx.users.get(id.toString()) || null)),
      find: vi.fn(() => query(() => [...ctx.users.values()])),
      countDocuments: vi.fn(() =>
        query(
          () =>
            [...ctx.users.values()].filter(
              user =>
                user.isAdmin && !user.suspended && !user.siteInvitationPending
            ).length
        )
      ),
      updateOne: vi.fn((filter, update) =>
        query(() => {
          Object.assign(ctx.users.get(filter._id.toString()), update.$set)
          return { matchedCount: 1 }
        })
      ),
    }
    ctx.SiteInvitation = {
      find: vi.fn(() => query(() => [])),
      findOne: vi.fn(() => query(() => null)),
    }
    ctx.audit = vi.fn().mockResolvedValue(undefined)
    ctx.removeSessions = vi.fn().mockResolvedValue(1)
    ctx.disconnectSockets = vi.fn().mockResolvedValue(1)
    let last = Promise.resolve()
    ctx.lock = vi.fn((_namespace, _key, action) => {
      const current = last.catch(() => {}).then(action)
      last = current
      return current
    })
    vi.doMock('../../../../app/src/models/User.mjs', () => ({ User: ctx.User }))
    vi.doMock('../../../../app/src/models/SiteInvitation.mjs', () => ({
      SiteInvitation: ctx.SiteInvitation,
    }))
    vi.doMock('../../../../app/src/infrastructure/LockManager.mjs', () => ({
      default: { promises: { runWithLock: ctx.lock } },
    }))
    vi.doMock(
      '../../../../app/src/Features/User/UserAuditLogHandler.mjs',
      () => ({ default: { promises: { addEntry: ctx.audit } } })
    )
    vi.doMock(
      '../../../../app/src/Features/User/UserSessionsManager.mjs',
      () => ({
        default: { promises: { removeSessionsFromRedis: ctx.removeSessions } },
      })
    )
    vi.doMock(
      '../../../../app/src/Features/Editor/EditorRealTimeController.mjs',
      () => ({ default: { emitToAll: ctx.disconnectSockets } })
    )
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/SiteInvitationManager.mjs',
      () => ({
        default: {
          status: invitation => invitation.status,
          toDTO: invitation => invitation,
        },
      })
    )
    ctx.manager = (
      await import('../../../../app/src/Features/ServerAdmin/UserAdminManager.mjs')
    ).default
    ctx.auditLog = { initiatorId: ADMIN, ip: '127.0.0.1' }
  })

  it('projects a safe account DTO and marks historical invitations untracked', async ctx => {
    const result = await ctx.manager.listUsers({ page: 1, pageSize: 25 })
    expect(result.items[2]).to.deep.equal({
      id: MEMBER,
      email: 'member@example.com',
      firstName: '',
      lastName: '',
      isAdmin: false,
      suspended: false,
      signUpDate: null,
      lastLoggedIn: null,
      invitationStatus: 'legacy',
    })
    expect(JSON.stringify(result)).not.to.include('private')
  })

  it('escapes query regex characters and supports role and suspension filters', async ctx => {
    await ctx.manager.listUsers({
      q: 'a.*[b]',
      page: 2,
      pageSize: 25,
      role: 'member',
      suspended: false,
    })
    const filter = ctx.User.find.mock.calls[0][0]
    expect(filter.$or[0].email.source).to.equal('a\\.\\*\\[b\\]')
    expect(filter.isAdmin).to.deep.equal({ $ne: true })
    expect(filter.suspended).to.deep.equal({ $ne: true })
  })

  it('audits permissions changes and invalidates existing sessions', async ctx => {
    const result = await ctx.manager.updateUser(
      MEMBER,
      { isAdmin: true },
      ctx.auditLog
    )
    expect(result.isAdmin).to.equal(true)
    expect(ctx.audit).toHaveBeenCalledWith(
      MEMBER,
      'admin-user-permissions-changed',
      ADMIN,
      '127.0.0.1',
      {
        previous: { isAdmin: false, suspended: false },
        changes: { isAdmin: true },
      }
    )
    expect(ctx.removeSessions).toHaveBeenCalledWith({ _id: MEMBER })
    expect(ctx.disconnectSockets).toHaveBeenCalledWith(
      'user:permissions:changed',
      { userId: MEMBER }
    )
    expect(ctx.disconnectSockets.mock.invocationCallOrder[0]).to.be.greaterThan(
      ctx.removeSessions.mock.invocationCallOrder[0]
    )
  })

  it('suspends and restores accounts without changing their project ownership', async ctx => {
    ctx.users.get(MEMBER).ownedProjects = ['project']
    await ctx.manager.updateUser(MEMBER, { suspended: true }, ctx.auditLog)
    expect(ctx.users.get(MEMBER).suspended).to.equal(true)
    await ctx.manager.updateUser(MEMBER, { suspended: false }, ctx.auditLog)
    expect(ctx.users.get(MEMBER).suspended).to.equal(false)
    expect(ctx.users.get(MEMBER).ownedProjects).to.deep.equal(['project'])
    expect(ctx.removeSessions).toHaveBeenCalledTimes(2)
  })

  it('rejects self-demotion and self-suspension', async ctx => {
    await expect(
      ctx.manager.updateUser(ADMIN, { isAdmin: false }, ctx.auditLog)
    ).to.be.rejectedWith('your own administrator')
    await expect(
      ctx.manager.updateUser(ADMIN, { suspended: true }, ctx.auditLog)
    ).to.be.rejectedWith('your own administrator')
    expect(ctx.User.updateOne).not.toHaveBeenCalled()
  })

  it('rejects granting administrator access before invitation acceptance', async ctx => {
    ctx.users.get(MEMBER).siteInvitationPending = true
    await expect(
      ctx.manager.updateUser(MEMBER, { isAdmin: true }, ctx.auditLog)
    ).to.be.rejectedWith('accept their invitation')
  })

  it('does not promote a placeholder holding account to administrator', async ctx => {
    ctx.users.get(MEMBER).holdingAccount = true
    await expect(
      ctx.manager.updateUser(MEMBER, { isAdmin: true }, ctx.auditLog)
    ).to.be.rejectedWith('accept their invitation')
  })

  it('normalizes target ObjectId spelling before checking self-demotion', async ctx => {
    const id = 'abcdef0123456789abcdef01'
    ctx.users.set(id, { _id: id, email: 'case@example.com', isAdmin: true })
    ctx.User.findById.mockImplementation(value =>
      query(() => ctx.users.get(value.toString().toLowerCase()))
    )
    await expect(
      ctx.manager.updateUser(
        id.toUpperCase(),
        { isAdmin: false },
        { ...ctx.auditLog, initiatorId: id }
      )
    ).to.be.rejectedWith('your own administrator')
  })

  it('invalidates sessions using the canonical database user ID', async ctx => {
    const id = 'abcdef0123456789abcdef01'
    ctx.users.set(id, { _id: id, email: 'case@example.com', isAdmin: false })
    ctx.User.findById.mockImplementation(value =>
      query(() => ctx.users.get(value.toString().toLowerCase()))
    )
    ctx.User.updateOne.mockImplementation((filter, update) =>
      query(() => {
        Object.assign(ctx.users.get(filter._id.toLowerCase()), update.$set)
        return { matchedCount: 1 }
      })
    )
    await ctx.manager.updateUser(
      id.toUpperCase(),
      { suspended: true },
      ctx.auditLog
    )
    expect(ctx.removeSessions).toHaveBeenCalledWith({ _id: id })
  })

  it('rejects changes when the actor was demoted while waiting for a lock', async ctx => {
    ctx.users.get(ADMIN).isAdmin = false
    await expect(
      ctx.manager.updateUser(MEMBER, { isAdmin: true }, ctx.auditLog)
    ).to.be.rejectedWith('Administrator access required')
    expect(ctx.User.updateOne).not.toHaveBeenCalled()
  })

  it('serializes competing admin removals and leaves an active administrator', async ctx => {
    const results = await Promise.allSettled([
      ctx.manager.updateUser(OTHER_ADMIN, { isAdmin: false }, ctx.auditLog),
      ctx.manager.updateUser(
        ADMIN,
        { isAdmin: false },
        { initiatorId: OTHER_ADMIN, ip: '127.0.0.2' }
      ),
    ])
    expect(results.map(result => result.status)).to.deep.equal([
      'fulfilled',
      'rejected',
    ])
    expect(ctx.users.get(ADMIN).isAdmin).to.equal(true)
    expect(ctx.users.get(OTHER_ADMIN).isAdmin).to.equal(false)
  })

  it('does not remove the last usable administrator', async ctx => {
    ctx.User.countDocuments.mockImplementation(() => query(() => 1))
    await expect(
      ctx.manager.updateUser(OTHER_ADMIN, { suspended: true }, ctx.auditLog)
    ).to.be.rejectedWith('last active administrator')
    expect(ctx.User.updateOne).not.toHaveBeenCalled()
  })

  it('does not mutate an account if audit persistence fails', async ctx => {
    ctx.audit.mockRejectedValue(new Error('audit unavailable'))
    await expect(
      ctx.manager.updateUser(MEMBER, { isAdmin: true }, ctx.auditLog)
    ).to.be.rejectedWith('audit unavailable')
    expect(ctx.User.updateOne).not.toHaveBeenCalled()
  })

  it('still revokes editor sockets if HTTP session invalidation fails', async ctx => {
    ctx.removeSessions.mockRejectedValue(
      new Error('session storage unavailable')
    )
    await expect(
      ctx.manager.updateUser(MEMBER, { suspended: true }, ctx.auditLog)
    ).to.be.rejectedWith('session storage unavailable')
    expect(ctx.disconnectSockets).toHaveBeenCalledWith(
      'user:permissions:changed',
      { userId: MEMBER }
    )
  })
})
