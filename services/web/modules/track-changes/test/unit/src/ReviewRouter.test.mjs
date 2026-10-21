import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = name =>
  new URL(`../../../../../app/src/${name}`, import.meta.url).pathname

describe('CE review route authorization', () => {
  let routes,
    privateRoutes,
    login,
    restricted,
    read,
    write,
    thread,
    privateAuth,
    controllers
  beforeEach(async () => {
    vi.resetModules()
    login = () => {}
    restricted = () => {}
    read = () => {}
    write = () => {}
    thread = () => {}
    privateAuth = () => {}
    controllers = new Proxy({}, { get: (_, name) => name })
    vi.doMock(
      source('Features/Authentication/AuthenticationController.mjs'),
      () => ({
        default: {
          requireLogin: () => login,
          requirePrivateApiAuth: () => privateAuth,
        },
      })
    )
    vi.doMock(
      source('Features/Authorization/AuthorizationMiddleware.mjs'),
      () => ({
        default: {
          blockRestrictedUserFromProject: restricted,
          ensureUserCanReadProject: read,
          ensureUserCanWriteProjectContent: write,
          ensureUserCanDeleteOrResolveThread: thread,
        },
      })
    )
    vi.doMock('../../../app/src/ReviewController.mjs', () => ({
      default: controllers,
    }))
    routes = []
    privateRoutes = []
    const router = rows =>
      Object.fromEntries(
        ['get', 'post', 'delete'].map(method => [
          method,
          (...args) =>
            rows.push({ method, path: args[0], middleware: args.slice(1) }),
        ])
      )
    const { default: moduleRouter } =
      await import('../../../app/src/ReviewRouter.mjs')
    moduleRouter.apply(router(routes), router(privateRoutes))
  })

  it('requires login, unrestricted membership and project read access for every web API', () => {
    expect(routes.length).toBe(13)
    for (const route of routes)
      expect(route.middleware.slice(0, 3)).toEqual([login, restricted, read])
  })

  it('checks thread resolve/delete permission and source-write permission for tracking toggles', () => {
    const stateRoutes = routes.filter(route =>
      route.path.includes('/doc/:doc_id/thread/')
    )
    expect(stateRoutes).toHaveLength(3)
    for (const route of stateRoutes) expect(route.middleware).toContain(thread)
    expect(
      routes.find(route => route.path.endsWith('/track_changes')).middleware
    ).toContain(write)
  })

  it('exposes author metadata exclusively behind private API authentication', () => {
    expect(privateRoutes).toEqual([
      {
        method: 'get',
        path: '/project/:project_id/thread/:thread_id/author',
        middleware: [privateAuth, 'getThreadAuthor'],
      },
    ])
    expect(routes.some(route => route.path.endsWith('/author'))).toBe(false)
  })
})
