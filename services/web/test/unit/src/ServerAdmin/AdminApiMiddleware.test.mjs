import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ensureActiveSiteAdmin', () => {
  beforeEach(async ctx => {
    ctx.account = { isAdmin: true }
    ctx.findById = vi.fn(() => ({
      lean: () => ({ exec: async () => ctx.account }),
    }))
    vi.doMock('../../../../app/src/models/User.mjs', () => ({
      User: { findById: ctx.findById },
    }))
    ctx.middleware = (
      await import('../../../../app/src/Features/ServerAdmin/AdminApiMiddleware.mjs')
    ).ensureActiveSiteAdmin
    ctx.req = { session: { user: { _id: 'admin' } } }
    ctx.res = { status: vi.fn(), json: vi.fn() }
    ctx.res.status.mockReturnValue(ctx.res)
    ctx.next = vi.fn()
  })

  it('allows an active administrator', async ctx => {
    await ctx.middleware(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalledWith()
    expect(ctx.res.status).not.toHaveBeenCalled()
  })

  for (const [name, account] of [
    ['missing user', null],
    ['ordinary member', { isAdmin: false }],
    ['suspended administrator', { isAdmin: true, suspended: true }],
    [
      'unactivated administrator',
      { isAdmin: true, siteInvitationPending: true },
    ],
  ]) {
    it(`rejects a ${name}`, async ctx => {
      ctx.account = account
      await ctx.middleware(ctx.req, ctx.res, ctx.next)
      expect(ctx.res.status).toHaveBeenCalledWith(403)
      expect(ctx.next).not.toHaveBeenCalled()
    })
  }

  it('rejects anonymous requests without querying MongoDB', async ctx => {
    ctx.req.session = {}
    await ctx.middleware(ctx.req, ctx.res, ctx.next)
    expect(ctx.res.status).toHaveBeenCalledWith(403)
    expect(ctx.findById).not.toHaveBeenCalled()
  })
})
