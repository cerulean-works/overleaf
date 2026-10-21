import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, prepareProjects } from '../prepare_review.mjs'
const id = 'a'.repeat(24)
const project = stage => ({
  _id: id,
  overleaf: { history: { id: 'history', otMigrationStage: stage } },
})

test('requires an explicit target and defaults to dry-run', () => {
  assert.throws(() => parseArgs([]), /Choose/)
  assert.throws(() => parseArgs(['--all', '--project-id', id]), /Choose/)
  assert.equal(parseArgs(['--all']).apply, false)
  assert.equal(parseArgs(['--project-id', id, '--apply']).apply, true)
  assert.throws(() => parseArgs(['--project-id', '$bad']), /Invalid/)
})

test('dry-run distinguishes quick preparation and resync without calling mutation', async () => {
  for (const hasRanges of [true, false]) {
    const result = await prepareProjects(
      [project(0)],
      { apply: false },
      {
        hasRanges: async () => hasRanges,
        prepare: () => assert.fail('dry-run must not mutate'),
      }
    )
    assert.equal(
      result.results[0].status,
      hasRanges ? 'would-resync' : 'would-enable'
    )
    assert.equal(result.failed, 0)
  }
})

test('preparation preserves ShareJS and already-migrated History OT stages', async () => {
  for (const stage of [0, 1, 2]) {
    const result = await prepareProjects(
      [project(stage)],
      { apply: true },
      {
        prepare: async () => ({ migrationType: 'quick' }),
        getProject: async () => ({
          overleaf: {
            history: { otMigrationStage: stage, rangesSupportEnabled: true },
          },
        }),
      }
    )
    assert.equal(result.results[0].status, 'prepared')
    assert.equal(result.results[0].otMigrationStage, stage)
  }
})

test('partial failures stop the batch and are reported; ready projects do not mutate', async () => {
  const ready = project(0)
  ready.overleaf.history.rangesSupportEnabled = true
  const result = await prepareProjects(
    [ready, project(1), project(2)],
    { apply: true },
    {
      prepare: async () => {
        throw new Error('resync failed')
      },
    }
  )
  assert.equal(result.failed, 1)
  assert.deepEqual(
    result.results.map(value => value.status),
    ['ready', 'failed']
  )
  assert.match(result.results[1].error, /resync failed/)
})

test('flags missing history and an unexpected OT stage change as failures', async () => {
  const missing = await prepareProjects([{ _id: id }], { apply: false }, {})
  assert.equal(missing.failed, 1)
  const changed = await prepareProjects(
    [project(0)],
    { apply: true },
    {
      prepare: async () => ({ migrationType: 'resync' }),
      getProject: async () => ({
        overleaf: {
          history: { otMigrationStage: 1, rangesSupportEnabled: true },
        },
      }),
    }
  )
  assert.match(changed.results[0].error, /OT stage changed/)
})
