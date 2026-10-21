import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('UserAdminRouter', () => {
  beforeEach(async ctx => {
    ctx.admin = vi.fn()
    ctx.active = vi.fn()
    ctx.controller = Object.fromEntries(
      [
        'listUsers',
        'updateUser',
        'listInvitations',
        'createInvitations',
        'resendInvitation',
        'revokeInvitation',
        'invitationLink',
      ].map(name => [name, vi.fn()])
    )
    vi.doMock(
      '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs',
      () => ({ default: { ensureUserIsSiteAdmin: ctx.admin } })
    )
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/AdminApiMiddleware.mjs',
      () => ({ ensureActiveSiteAdmin: ctx.active })
    )
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/UserAdminController.mjs',
      () => ({ default: ctx.controller })
    )
    ctx.router = (
      await import('../../../../app/src/Features/ServerAdmin/UserAdminRouter.mjs')
    ).default
    ctx.webRouter = { get: vi.fn(), post: vi.fn(), patch: vi.fn() }
    ctx.router.apply(ctx.webRouter)
  })

  it('guards every directory and mutation with both administrator checks', ctx => {
    const routes = [
      ...ctx.webRouter.get.mock.calls,
      ...ctx.webRouter.post.mock.calls,
      ...ctx.webRouter.patch.mock.calls,
    ]
    expect(routes).to.have.length(7)
    for (const [, middleware] of routes)
      expect(middleware).to.deep.equal([ctx.active, ctx.admin])
  })
})
