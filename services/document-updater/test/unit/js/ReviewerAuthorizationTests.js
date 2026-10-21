const sinon = require('sinon')
const { expect } = require('chai')
const SandboxedModule = require('sandboxed-module')
const RangesTracker = require('@overleaf/ranges-tracker')
const {
  StringFileData,
  TextOperation,
  AddCommentOperation,
  Range,
} = require('overleaf-editor-core')
const TrackingProps = require('overleaf-editor-core/lib/file_data/tracking_props')
const policy = require('../../../app/js/ReviewPolicy')
const USER = 'reviewer'
const OTHER = 'another-author'
const date = new Date('2026-10-21T00:00:00Z')

describe('ShareJS reviewer authorization before commit/broadcast', function () {
  async function apply(author, options = {}) {
    const change = {
      id: 'change',
      op: { p: 3, d: ' bar' },
      metadata: { user_id: author, ts: date },
    }
    const doc = options.doc || {
      lines: ['foo'],
      version: 3,
      ranges: { changes: [change] },
    }
    const DB = SandboxedModule.require('../../../app/js/ShareJsDB', {
      requires: {
        './RedisManager': {},
        './DocumentManager': { promises: { getDoc: async () => doc } },
        './ReviewPolicy': policy,
        './RangesManager': {
          applyUpdate: (project, docId, ranges, updates) => {
            const tracker = new RangesTracker(
              structuredClone(ranges.changes),
              []
            )
            tracker.track_changes = true
            for (const update of updates) {
              for (const op of update.op)
                tracker.applyOp(op, { user_id: update.meta.user_id })
            }
            return { newRanges: { changes: tracker.changes } }
          },
        },
      },
    })
    const db = new DB('project', 'doc', doc.lines, doc.version)
    const update = options.update || {
      op: [{ p: 3, i: ' bar', u: true }],
      meta: { user_id: USER, reviewer: true, tc: 'seed' },
    }
    const error = await new Promise(resolve =>
      db.writeOp('project:doc', update, resolve)
    )
    return { error, db }
  }

  it('allows undoing the reviewer own suggestion', async function () {
    const { error, db } = await apply(USER)
    expect(error).to.be.undefined
    expect(db.appliedOps['project:doc']).to.have.length(1)
  })

  it('rejects a viewer replacement of an existing anchor before recording the op', async function () {
    const { error, db } = await apply(USER, {
      doc: {
        lines: ['foo'],
        version: 3,
        ranges: {
          changes: [],
          comments: [{ id: 'existing', op: { p: 0, c: 'foo', t: 'existing' } }],
        },
      },
      update: {
        op: [{ p: 0, c: 'foo', t: 'existing' }],
        meta: { user_id: USER, canEdit: false, reviewer: false },
      },
    })
    expect(error.statusCode).to.equal(403)
    expect(db.appliedOps).to.deep.equal({})
  })

  it('rejects a forged undo of another author before recording the op', async function () {
    const { error, db } = await apply(OTHER)
    expect(error.statusCode).to.equal(403)
    expect(db.appliedOps).to.deep.equal({})
  })
})

describe('History OT reviewer authorization after rebasing and before persistence', function () {
  beforeEach(function () {
    this.redis = {
      promises: {
        updateDocument: sinon.stub().resolves(),
        getPreviousDocOps: sinon.stub().resolves([]),
        recordProjectNotificationTimestamp: sinon.stub().resolves(),
      },
    }
    this.document = { promises: { getDoc: sinon.stub() } }
    this.commentAuthor = USER
    const commentAuth = SandboxedModule.require(
      '../../../app/js/CommentAuthorization',
      {
        requires: {
          './ReviewPolicy': policy,
          './WebApiManager': {
            promises: {
              getCommentThreadAuthor: async () => this.commentAuthor,
            },
          },
        },
      }
    )
    this.manager = SandboxedModule.require(
      '../../../app/js/HistoryOTUpdateManager',
      {
        requires: {
          './CommentAuthorization': commentAuth,
          './DocumentManager': this.document,
          './RedisManager': this.redis,
          './ReviewPolicy': policy,
          './Metrics': { inc: sinon.stub() },
          './Profiler': class {
            log() {
              return this
            }
            end() {}
          },
          './ProjectHistoryRedisManager': {
            promises: { queueOps: sinon.stub().resolves(1) },
          },
          './HistoryManager': { recordAndFlushHistoryOps: sinon.stub() },
          './RealTimeRedisManager': { sendData: sinon.stub() },
        },
      }
    )
  })

  it('permits a reviewer own tracked insertion', async function () {
    this.document.promises.getDoc.resolves({
      lines: { content: 'foo' },
      version: 1,
      type: 'history-ot',
      pathname: 'main.tex',
    })
    // TextOperation uses an options object for insertion tracking.
    const tracked = new TextOperation()
    tracked.retain(3)
    tracked.insert(' bar', {
      tracking: new TrackingProps('insert', USER, date),
    })
    await this.manager.applyUpdate('project', 'doc', {
      op: [tracked.toJSON()],
      v: 1,
      meta: { reviewer: true, user_id: USER },
    })
    expect(this.redis.promises.updateDocument).to.have.been.calledOnce
    const file = StringFileData.fromRaw(
      this.redis.promises.updateDocument.firstCall.args[2]
    )
    expect(file.getContent()).to.equal('foo bar')
  })

  it('permits inserting a reviewer suggestion inside another author tracked insertion', async function () {
    const raw = {
      content: 'abc',
      trackedChanges: [
        {
          range: { pos: 0, length: 3 },
          tracking: { type: 'insert', userId: OTHER, ts: date.toISOString() },
        },
      ],
    }
    this.document.promises.getDoc.resolves({
      lines: raw,
      version: 1,
      type: 'history-ot',
      pathname: 'main.tex',
    })
    const tracked = new TextOperation()
    tracked.retain(1)
    tracked.insert('NEW', { tracking: new TrackingProps('insert', USER, date) })
    tracked.retain(2)
    await this.manager.applyUpdate('project', 'doc', {
      op: [tracked.toJSON()],
      v: 1,
      meta: { reviewer: true, user_id: USER },
    })
    const file = StringFileData.fromRaw(
      this.redis.promises.updateDocument.firstCall.args[2]
    )
    expect(file.getContent()).to.equal('aNEWbc')
    expect(
      file
        .getTrackedChanges()
        .asSorted()
        .filter(change => change.tracking.userId === OTHER)
    ).to.have.length(2)
  })

  it('does not let a raw reviewer anchor operation reopen an existing resolved thread', async function () {
    const file = new StringFileData('foo')
    new AddCommentOperation('existing', [new Range(0, 3)], true).apply(file)
    this.document.promises.getDoc.resolves({
      lines: file.toRaw(),
      version: 1,
      type: 'history-ot',
      pathname: 'main.tex',
    })
    const move = new AddCommentOperation('existing', [new Range(1, 2)])
    await this.manager.applyUpdate('project', 'doc', {
      op: [move.toJSON()],
      v: 1,
      meta: { canEdit: false, reviewer: true, user_id: USER },
    })
    const after = StringFileData.fromRaw(
      this.redis.promises.updateDocument.firstCall.args[2]
    )
    expect(after.getComments().getComment('existing').resolved).to.be.true
    const persistedOp =
      this.redis.promises.updateDocument.firstCall.args[4][0].op[0]
    expect(persistedOp.resolved).to.be.true
  })

  it('denies a viewer replacing an existing History OT comment before persistence', async function () {
    const file = new StringFileData('foo')
    new AddCommentOperation('existing', [new Range(0, 3)]).apply(file)
    this.document.promises.getDoc.resolves({
      lines: file.toRaw(),
      version: 1,
      type: 'history-ot',
      pathname: 'main.tex',
    })
    const move = new AddCommentOperation('existing', [new Range(1, 2)])
    await expect(
      this.manager.applyUpdate('project', 'doc', {
        op: [move.toJSON()],
        v: 1,
        meta: { canEdit: false, reviewer: false, user_id: USER },
      })
    ).to.be.rejectedWith('cannot replace')
    expect(this.redis.promises.updateDocument).not.to.have.been.called
  })

  it('denies spoofing another author identity', async function () {
    this.document.promises.getDoc.resolves({
      lines: { content: 'foo' },
      version: 1,
      type: 'history-ot',
      pathname: 'main.tex',
    })
    const tracked = new TextOperation()
    tracked.retain(3)
    tracked.insert(' bar', {
      tracking: new TrackingProps('insert', OTHER, date),
    })
    await expect(
      this.manager.applyUpdate('project', 'doc', {
        op: [tracked.toJSON()],
        v: 1,
        meta: { reviewer: true, user_id: USER },
      })
    ).to.be.rejectedWith('forge')
    expect(this.redis.promises.updateDocument).not.to.have.been.called
  })

  it('denies retagging another author insertion as a reviewer deletion', async function () {
    const raw = {
      content: 'foo bar',
      trackedChanges: [
        {
          range: { pos: 3, length: 4 },
          tracking: { type: 'insert', userId: OTHER, ts: date.toISOString() },
        },
      ],
    }
    this.document.promises.getDoc.resolves({
      lines: raw,
      version: 1,
      type: 'history-ot',
      pathname: 'main.tex',
    })
    const tracked = new TextOperation()
    tracked.retain(3)
    tracked.retain(
      { r: 4 },
      { tracking: new TrackingProps('delete', USER, date) }
    )
    await expect(
      this.manager.applyUpdate('project', 'doc', {
        op: [tracked.toJSON()],
        v: 1,
        meta: { reviewer: true, user_id: USER },
      })
    ).to.be.rejectedWith('another author')
    expect(this.redis.promises.updateDocument).not.to.have.been.called
  })
})

describe('comment anchor authorization under the document lock', function () {
  function authorize(author) {
    return SandboxedModule.require('../../../app/js/CommentAuthorization', {
      requires: {
        './ReviewPolicy': policy,
        './WebApiManager': {
          promises: { getCommentThreadAuthor: async () => author },
        },
      },
    }).assertCommentAnchors
  }
  const update = { meta: { user_id: USER, canEdit: false, reviewer: false } }
  it('permits a new viewer anchor only for a thread authored by that viewer', async function () {
    await authorize(USER)('project', [], update, ['new-thread'])
    await expect(
      authorize(OTHER)('project', [], update, ['other-thread'])
    ).to.be.rejectedWith('another author')
  })
  it('rejects viewer replacement of an existing anchor, even their own', async function () {
    await expect(
      authorize(USER)('project', [{ id: 'existing' }], update, ['existing'])
    ).to.be.rejectedWith('cannot replace')
  })
  it('lets reviewers move their own anchors but denies relocating somebody else thread', async function () {
    const reviewUpdate = { meta: { ...update.meta, reviewer: true } }
    await authorize(USER)('project', [{ id: 'existing' }], reviewUpdate, [
      'existing',
    ])
    await expect(
      authorize(OTHER)('project', [{ id: 'existing' }], reviewUpdate, [
        'existing',
      ])
    ).to.be.rejectedWith('another author')
  })
  it('keeps existing writer anchor behavior without an author lookup', async function () {
    const assertAnchors = SandboxedModule.require(
      '../../../app/js/CommentAuthorization',
      {
        requires: {
          './ReviewPolicy': policy,
          './WebApiManager': {
            promises: {
              getCommentThreadAuthor: () => {
                throw new Error('unexpected author lookup')
              },
            },
          },
        },
      }
    ).assertCommentAnchors
    await assertAnchors(
      'project',
      [{ id: 'existing' }],
      { meta: { canEdit: true } },
      ['existing']
    )
  })
})
