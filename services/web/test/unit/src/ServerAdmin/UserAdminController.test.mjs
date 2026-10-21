import { beforeEach, describe, expect, it, vi } from 'vitest'
import MockRequest from '../helpers/MockRequest.mjs'

describe('UserAdminController', () => {
  beforeEach(async ctx => {
    ctx.manager = {
      listUsers: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
      listInvitations: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
      updateUser: vi.fn().mockResolvedValue({ id: '111111111111111111111111' }),
    }
    ctx.invitations = {
      create: vi.fn(),
      resend: vi.fn(),
      revoke: vi.fn(),
      link: vi.fn(),
    }
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/UserAdminManager.mjs',
      () => ({ default: ctx.manager })
    )
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/SiteInvitationManager.mjs',
      () => ({ default: ctx.invitations })
    )
    ctx.controller = (
      await import('../../../../app/src/Features/ServerAdmin/UserAdminController.mjs')
    ).default
    ctx.req = new MockRequest(vi)
    ctx.req.session.user = { _id: '222222222222222222222222' }
    ctx.res = { set: vi.fn(), json: vi.fn(), status: vi.fn() }
    ctx.res.status.mockReturnValue(ctx.res)
    ctx.next = vi.fn()
  })

  it('bounds pagination and coerces role/state filters', async ctx => {
    ctx.req.query = {
      page: '2',
      pageSize: '10',
      role: 'member',
      suspended: 'false',
    }
    await ctx.controller.listUsers(ctx.req, ctx.res, ctx.next)
    expect(ctx.manager.listUsers).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      role: 'member',
      suspended: false,
    })
    expect(ctx.res.set).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  for (const query of [
    { page: '0' },
    { pageSize: '101' },
    { suspended: 'yes' },
    { role: 'owner' },
    { q: { $ne: '' } },
  ]) {
    it(`rejects invalid query ${JSON.stringify(query)}`, async ctx => {
      ctx.req.query = query
      await ctx.controller.listUsers(ctx.req, ctx.res, ctx.next)
      expect(ctx.next).toHaveBeenCalled()
      expect(ctx.manager.listUsers).not.toHaveBeenCalled()
    })
  }

  it('rejects privilege escalation through unknown user fields', async ctx => {
    ctx.req.params = { userId: '111111111111111111111111' }
    ctx.req.body = {
      isAdmin: true,
      hashedPassword: 'injected',
      features: { compileTimeout: 9999 },
    }
    await ctx.controller.updateUser(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalled()
    expect(ctx.manager.updateUser).not.toHaveBeenCalled()
  })

  it('rejects malformed target IDs before accessing the database', async ctx => {
    ctx.req.params = { userId: 'bad-id' }
    ctx.req.body = { isAdmin: false }
    await ctx.controller.updateUser(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalled()
    expect(ctx.manager.updateUser).not.toHaveBeenCalled()
  })

  it('returns per-email results and omits activation URLs', async ctx => {
    const { UserAdminError } =
      await import('../../../../app/src/Features/ServerAdmin/UserAdminErrors.mjs')
    ctx.req.body = {
      emails: [
        'alice@example.com',
        'existing@example.com',
        'alice@example.com',
      ],
    }
    ctx.invitations.create
      .mockResolvedValueOnce({
        invitation: { email: 'alice@example.com' },
        url: 'private-token',
      })
      .mockRejectedValueOnce(new UserAdminError('Already registered.'))
    await ctx.controller.createInvitations(ctx.req, ctx.res, ctx.next)
    expect(ctx.res.json).toHaveBeenCalledWith({
      results: [
        {
          email: 'alice@example.com',
          status: 'invited',
          invitation: { email: 'alice@example.com' },
        },
        {
          email: 'existing@example.com',
          status: 'error',
          error: 'Already registered.',
        },
      ],
    })
    expect(ctx.invitations.create).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(ctx.res.json.mock.calls)).not.to.include(
      'private-token'
    )
  })

  it('preserves earlier batch results when later provisioning fails without exposing secrets', async ctx => {
    ctx.req.body = { emails: ['alice@example.com', 'failing@example.com'] }
    ctx.invitations.create
      .mockResolvedValueOnce({ invitation: { email: 'alice@example.com' } })
      .mockRejectedValueOnce(new Error('password=private'))
    await ctx.controller.createInvitations(ctx.req, ctx.res, ctx.next)
    const { results } = ctx.res.json.mock.calls[0][0]
    expect(results[0].status).to.equal('invited')
    expect(results[1].status).to.equal('error')
    expect(JSON.stringify(results)).not.to.include('private')
  })
})
