import { beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath =
  '../../../../app/src/Features/ServerAdmin/ProjectAdminController.mjs'
const id = '0123456789abcdef01234567'

describe('server project directory', () => {
  beforeEach(async ctx => {
    ctx.db = {
      projects: {
        aggregate: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([{ items: [], count: [] }]),
        })),
        findOne: vi.fn(),
      },
      users: {
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      },
      projectInvites: {
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      },
    }
    vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => ({
      db: ctx.db,
      ObjectId: class {
        constructor(value) {
          this.value = value
        }
        toString() {
          return this.value
        }
      },
    }))
    ctx.controller = (await import(modulePath)).default
    ctx.res = {
      json: vi.fn(),
      status: vi.fn(),
      sendStatus: vi.fn(),
      set: vi.fn(),
    }
    ctx.res.status.mockReturnValue(ctx.res)
  })
  it('rejects malformed pagination before querying the database', async ctx => {
    await ctx.controller.list(
      { query: { pageSize: '10000' } },
      ctx.res,
      vi.fn()
    )
    expect(ctx.res.status).toHaveBeenCalledWith(400)
    expect(ctx.db.projects.aggregate).not.toHaveBeenCalled()
  })
  it('returns a bounded safe empty result', async ctx => {
    await ctx.controller.list({ query: {} }, ctx.res, vi.fn())
    expect(ctx.res.json).toHaveBeenCalledWith({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    })
  })
  it('reports missing and malformed project IDs separately', async ctx => {
    await ctx.controller.details(
      { params: { Project_id: 'invalid' } },
      ctx.res,
      vi.fn()
    )
    expect(ctx.res.status).toHaveBeenCalledWith(400)
    ctx.db.projects.findOne.mockResolvedValue(null)
    await ctx.controller.details(
      { params: { Project_id: id } },
      ctx.res,
      vi.fn()
    )
    expect(ctx.res.sendStatus).toHaveBeenCalledWith(404)
  })
  it('never exposes share tokens, root files, or invite secrets in project details', async ctx => {
    ctx.db.projects.findOne.mockResolvedValue({
      _id: id,
      owner_ref: id,
      name: 'Private paper',
      tokens: { readOnly: 'private-token' },
      rootFolder: ['private-file'],
    })
    ctx.db.users.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: id, email: 'owner@example.com', hashedPassword: 'secret' },
        ]),
    })
    ctx.db.projectInvites.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: id,
          email: 'reader@example.com',
          privileges: 'readOnly',
          encryptedToken: 'private-invite',
        },
      ]),
    })
    await ctx.controller.details(
      { params: { Project_id: id } },
      ctx.res,
      vi.fn()
    )
    const payload = ctx.res.json.mock.calls[0][0]
    expect(payload.members).toEqual([
      { id, email: 'owner@example.com', name: '', privilegeLevel: 'owner' },
    ])
    expect(payload.invitations).toEqual([
      { id, email: 'reader@example.com', privilegeLevel: 'readOnly' },
    ])
    expect(JSON.stringify(payload)).not.toMatch(
      /private-token|private-file|private-invite|hashedPassword/
    )
  })
  it('includes sharing-link members and gives named membership precedence', async ctx => {
    const project = {
      _id: id,
      name: 'Linked paper',
      tokenAccessReadOnly_refs: [id],
    }
    ctx.db.projects.findOne.mockResolvedValue(project)
    ctx.db.users.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: id, email: 'reader@example.com' }]),
    })
    await ctx.controller.details(
      { params: { Project_id: id } },
      ctx.res,
      vi.fn()
    )
    expect(ctx.res.json.mock.calls.at(-1)[0].members[0]).toMatchObject({
      privilegeLevel: 'readOnly',
      accessSource: 'link',
    })
    project.collaberator_refs = [id]
    await ctx.controller.details(
      { params: { Project_id: id } },
      ctx.res,
      vi.fn()
    )
    expect(ctx.res.json.mock.calls.at(-1)[0].members[0]).toMatchObject({
      privilegeLevel: 'readAndWrite',
    })
    expect(ctx.res.json.mock.calls.at(-1)[0].members[0]).not.toHaveProperty(
      'accessSource'
    )
  })
})
