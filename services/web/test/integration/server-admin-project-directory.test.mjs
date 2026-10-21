import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import mongodb from 'mongodb-legacy'
import {
  buildProjectPipeline,
  parseProjectQuery,
  projectDto,
} from '../../app/src/Features/ServerAdmin/ProjectAdminPolicy.mjs'

const url = process.env.OVERLEAF_TEST_MONGO_URL || 'mongodb://127.0.0.1:27028'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
  throw new Error(
    'This disposable fixture test only supports a local MongoDB endpoint'
  )
}
const { MongoClient, ObjectId } = mongodb
const client = new MongoClient(url, { serverSelectionTimeoutMS: 10000 })
const db = client.db(`cerulean_admin_test_${process.pid}`)
const owner = new ObjectId()
const member = new ObjectId()

before(async () => {
  await client.connect()
  await db.collection('users').insertMany([
    { _id: owner, email: 'owner@example.test', first_name: 'Owner' },
    { _id: member, email: 'member@example.test' },
  ])
  await db.collection('projects').insertMany(
    Array.from({ length: 62 }, (_, index) => ({
      _id: new ObjectId(),
      name: index === 0 ? 'literal.*project' : `Paper ${index}`,
      owner_ref: index === 61 ? new ObjectId() : owner,
      lastUpdated: new Date('2026-10-21T00:00:00Z'),
      archived: index === 1 ? [owner] : [],
      trashed: index === 2 ? [owner] : [],
      active: index !== 3,
      tokenAccessReadOnly_refs: index === 7 ? [member] : [],
      tokenAccessReadAndWrite_refs: index === 8 ? [member] : [],
      readOnly_refs: index === 4 ? [member] : [],
      collaberator_refs: index === 5 ? [member] : [],
      reviewer_refs: index === 6 ? [member] : [],
      tokens: { readOnly: 'secret-link' },
      rootFolder: ['private-document'],
    }))
  )
})

after(async () => {
  await db.dropDatabase()
  await client.close()
})

async function directory(query = {}) {
  const [result] = await db
    .collection('projects')
    .aggregate(
      buildProjectPipeline(
        parseProjectQuery(query),
        value => new ObjectId(value)
      )
    )
    .toArray()
  return {
    total: result.count[0]?.total || 0,
    items: result.items.map(projectDto),
  }
}

test('all live records are paginated exactly once, including missing owners and archived/trash/inactive rows', async () => {
  const pages = await Promise.all(
    ['1', '2', '3'].map(page => directory({ page }))
  )
  assert.deepEqual(
    pages.map(page => page.total),
    [62, 62, 62]
  )
  const items = pages.flatMap(page => page.items)
  assert.equal(new Set(items.map(project => project.id)).size, 62)
  assert.equal(items.filter(project => project.owner === null).length, 1)
  assert.equal(items.filter(project => project.archivedByOwner).length, 1)
  assert.equal(items.filter(project => project.trashedByOwner).length, 1)
  assert.doesNotMatch(JSON.stringify(items), /secret-link|private-document/)
})

test('owner searches, membership filters and literal search are evaluated by MongoDB', async () => {
  assert.equal((await directory({ q: 'owner@example.test' })).total, 61)
  assert.equal((await directory({ owner: owner.toString() })).total, 61)
  assert.equal((await directory({ userId: member.toString() })).total, 5)
  assert.equal((await directory({ q: 'literal.*' })).total, 1)
})

test('exact project IDs find the corresponding server project', async () => {
  const project = await db.collection('projects').findOne({ name: 'Paper 61' })
  const result = await directory({ q: project._id.toString() })
  assert.equal(result.total, 1)
  assert.equal(result.items[0].name, 'Paper 61')
})
