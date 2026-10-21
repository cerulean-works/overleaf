import { describe, expect, it, vi } from 'vitest'

describe('server project administration routes', () => {
  it('guards every route and reuses project authorization for every membership mutation', async () => {
    const siteAdmin = vi.fn()
    const projectAdmin = vi.fn()
    const activeAdmin = vi.fn()
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/AdminApiMiddleware.mjs',
      () => ({ ensureActiveSiteAdmin: activeAdmin })
    )
    vi.doMock(
      '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs',
      () => ({
        default: {
          ensureUserIsSiteAdmin: siteAdmin,
          ensureUserCanAdminProject: projectAdmin,
        },
      })
    )
    vi.doMock(
      '../../../../app/src/Features/ServerAdmin/ProjectAdminController.mjs',
      () => ({ default: { list: vi.fn(), details: vi.fn() } })
    )
    vi.doMock(
      '../../../../app/src/Features/Collaborators/CollaboratorsController.mjs',
      () => ({
        default: {
          setCollaboratorInfo: vi.fn(),
          removeUserFromProject: vi.fn(),
        },
      })
    )
    vi.doMock(
      '../../../../app/src/Features/Collaborators/CollaboratorsInviteController.mjs',
      () => ({
        default: {
          inviteToProject: vi.fn(),
          revokeInvite: vi.fn(),
          generateNewInvite: vi.fn(),
        },
      })
    )
    const router = (
      await import('../../../../app/src/Features/ServerAdmin/ProjectAdminRouter.mjs')
    ).default
    const web = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
    router.apply(web)
    const all = Object.values(web).flatMap(method => method.mock.calls)
    expect(all).toHaveLength(8)
    for (const route of all) {
      expect(route[1]).toBe(activeAdmin)
      expect(route[2]).toBe(siteAdmin)
    }
    for (const method of [web.post, web.put, web.delete])
      for (const route of method.mock.calls) expect(route[3]).toBe(projectAdmin)
    expect(
      all.some(([path]) => /transfer|recover|delete-project/.test(path))
    ).toBe(false)
  })
})
