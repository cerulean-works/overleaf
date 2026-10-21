import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = name =>
  new URL(`../../../../../app/src/${name}`, import.meta.url).pathname

describe('CE effective review entitlement', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  async function model(saas, available) {
    vi.doMock('@overleaf/settings', () => ({
      default: { overleaf: saas ? {} : undefined },
    }))
    const { default: handler } = await import(
      source('Features/Project/ProjectEditorHandler.mjs')
    )
    handler.trackChangesAvailable = available
    const storedFeatures = { trackChanges: false, compileTimeout: 100 }
    const result = handler.buildProjectModelView(
      {
        _id: 'project',
        owner_ref: 'owner',
        rootFolder: [{ folders: [], docs: [], fileRefs: [] }],
      },
      { user: { _id: 'owner', features: storedFeatures } },
      [],
      [],
      false
    )
    return { result, storedFeatures }
  }
  it('enables review for imported CE users without rewriting their stored features', async () => {
    const { result, storedFeatures } = await model(false, true)
    expect(result.features.trackChanges).toBe(true)
    expect(result.features.trackChangesVisible).toBe(true)
    expect(result.features.reviewActionsViaHttp).toBe(true)
    expect(result.features.compileTimeout).toBe(100)
    expect(storedFeatures.trackChanges).toBe(false)
  })
  it('does not advertise review without an installed implementation', async () => {
    const { result } = await model(false, false)
    expect(result.features.trackChanges).toBe(false)
    expect(result.features.trackChangesVisible).toBe(false)
    expect(result.features.reviewActionsViaHttp).toBeUndefined()
  })
  it('keeps SaaS subscription entitlements independent', async () => {
    const { result } = await model(true, true)
    expect(result.features.trackChanges).toBe(false)
    expect(result.features.reviewActionsViaHttp).toBeUndefined()
  })
})
