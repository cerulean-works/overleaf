import { describe, expect, it } from 'vitest'
import {
  buildProjectPipeline,
  literalSearch,
  parseProjectQuery,
  projectDto,
} from '../../../../app/src/Features/ServerAdmin/ProjectAdminPolicy.mjs'

describe('server project directory policy', () => {
  it('bounds pagination and rejects ambiguous query inputs', () => {
    expect(parseProjectQuery({})).toMatchObject({ page: 1, pageSize: 25 })
    for (const query of [
      { page: '0' },
      { pageSize: '101' },
      { q: ['a', 'b'] },
      { userId: 'wrong' },
      { password: 'x' },
      { page: '1.5' },
    ]) {
      expect(() => parseProjectQuery(query)).toThrow()
    }
  })
  it('treats regular expression characters as literal search text', () => {
    expect(literalSearch('a.*[b]$').$regex).toBe('a\\.\\*\\[b\\]\\$')
  })
  it('does not filter out other owners, archived, trashed, or inactive projects', () => {
    const pipeline = buildProjectPipeline(parseProjectQuery({}), value => value)
    expect(pipeline.some(stage => stage.$match)).toBe(false)
    expect(pipeline.at(-1).$facet.items[0]).toEqual({
      $sort: { lastUpdated: -1, _id: -1 },
    })
  })
  it('filters user access across owner, editor, reviewer, and viewer roles', () => {
    const userId = '0123456789abcdef01234567'
    const [stage] = buildProjectPipeline(
      parseProjectQuery({ userId }),
      value => value
    )
    expect(stage.$match.$or).toEqual(
      [
        'owner_ref',
        'collaberator_refs',
        'reviewer_refs',
        'readOnly_refs',
        'tokenAccessReadOnly_refs',
        'tokenAccessReadAndWrite_refs',
      ].map(field => ({ [field]: userId }))
    )
  })
  it('matches exact project and owner IDs in the server search', () => {
    const id = '0123456789abcdef01234567'
    const pipeline = buildProjectPipeline(
      parseProjectQuery({ q: id }),
      value => value
    )
    const stage = pipeline.find(item => item.$match)
    expect(stage.$match.$or).toContainEqual({ _id: id })
    expect(stage.$match.$or).toContainEqual({ owner_ref: id })
  })
  it('projects safe fields and represents missing owners without leaking project contents', () => {
    const dto = projectDto({
      _id: 'project',
      owner_ref: 'owner',
      name: 'Paper',
      archived: ['owner'],
      trashed: ['other'],
      tokens: { readOnly: 'secret' },
      rootFolder: ['private'],
      active: false,
    })
    expect(dto).toEqual({
      id: 'project',
      name: 'Paper',
      owner: null,
      lastUpdated: null,
      archivedByOwner: true,
      trashedByOwner: false,
    })
  })
})
