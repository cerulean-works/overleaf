const sinon = require('sinon')
const { expect } = require('chai')
const SandboxedModule = require('sandboxed-module')
const { StringFileData, EditOperationBuilder } = require('overleaf-editor-core')
const RangesTracker = require('@overleaf/ranges-tracker')
const textType = require('../../../app/js/sharejs/types/text')
const {
  selectChanges,
  assertProtectedChanges,
} = require('../../../app/js/ReviewPolicy')

const USER = 'a'.repeat(24)
const OTHER = 'b'.repeat(24)
const TS = '2026-10-21T00:00:00.000Z'

function suggested(content, start, length, type, userId = USER) {
  return {
    content,
    trackedChanges: [
      { range: { pos: start, length }, tracking: { type, userId, ts: TS } },
    ],
  }
}

function selector(raw, index = 0) {
  const change = raw.trackedChanges[index]
  return {
    start: change.range.pos,
    length: change.range.length,
    type: change.tracking.type,
    user_id: change.tracking.userId,
    ts: change.tracking.ts,
    content: raw.content.slice(
      change.range.pos,
      change.range.pos + change.range.length
    ),
  }
}

describe('server-authorized review actions', function () {
  beforeEach(function () {
    this.doc = {
      version: 4,
      type: 'sharejs-text-ot',
      lines: ['foo bar'],
      ranges: {
        changes: [
          {
            id: 'change-1',
            op: { p: 3, i: ' bar' },
            metadata: { user_id: USER, ts: TS },
          },
        ],
      },
    }
    this.DocumentManager = {
      promises: {
        getDoc: sinon.stub().callsFake(async () => this.doc),
        acceptChanges: sinon.stub().resolves(),
      },
    }
    this.UpdateManager = {
      promises: {
        lockUpdatesAndDo: sinon
          .stub()
          .callsFake(async (fn, ...args) => fn(...args)),
        applyUpdate: sinon.stub().callsFake(async (project, doc, update) => {
          this.doc.lines = textType
            .apply(this.doc.lines.join('\n'), update.op)
            .split('\n')
          const tracker = new RangesTracker(
            structuredClone(this.doc.ranges.changes),
            []
          )
          tracker.track_changes = false
          for (const op of update.op) tracker.applyOp(op, { user_id: USER })
          this.doc.ranges.changes = tracker.changes
        }),
      },
    }
    this.HistoryOT = {
      applyUpdate: sinon.stub().callsFake(async (project, doc, update) => {
        const file = StringFileData.fromRaw(this.doc.lines)
        for (const op of update.op) file.edit(EditOperationBuilder.fromJSON(op))
        this.doc.lines = file.toRaw()
      }),
    }
    this.manager = SandboxedModule.require(
      '../../../app/js/ReviewActionManager',
      {
        requires: {
          './DocumentManager': this.DocumentManager,
          './UpdateManager': this.UpdateManager,
          './HistoryOTUpdateManager': this.HistoryOT,
          './ReviewPolicy': require('../../../app/js/ReviewPolicy'),
        },
      }
    )
    this.request = {
      version: 4,
      user_id: USER,
      own_only: false,
      change_ids: ['change-1'],
    }
  })

  it('accepts current ShareJS changes through the locked updater', async function () {
    await this.manager.decide('project', 'doc', 'accept', this.request)
    expect(this.UpdateManager.promises.lockUpdatesAndDo).to.have.been.calledOnce
    expect(this.DocumentManager.promises.acceptChanges).to.have.been.calledWith(
      'project',
      'doc',
      ['change-1']
    )
  })

  it('lets reviewers reject their own ShareJS insertion without creating another suggestion', async function () {
    await this.manager.decide('project', 'doc', 'reject', {
      ...this.request,
      own_only: true,
    })
    expect(this.doc.lines).to.deep.equal(['foo'])
    expect(this.doc.ranges.changes).to.have.length(0)
    expect(this.UpdateManager.promises.applyUpdate.firstCall.args[2].meta.tc).to
      .be.undefined
  })

  it('restores a tracked ShareJS deletion', async function () {
    this.doc.lines = ['foo']
    this.doc.ranges.changes[0].op = { p: 3, d: ' bar' }
    await this.manager.decide('project', 'doc', 'reject', this.request)
    expect(this.doc.lines).to.deep.equal(['foo bar'])
    expect(this.doc.ranges.changes).to.have.length(0)
  })

  it('rejects grouped adjacent replacement operations in stable order', async function () {
    this.doc.lines = ['foo quux baz']
    this.doc.ranges.changes = [
      {
        id: 'insert',
        op: { p: 4, i: 'quux' },
        metadata: { user_id: USER, ts: TS },
      },
      {
        id: 'delete',
        op: { p: 8, d: 'bar' },
        metadata: { user_id: USER, ts: TS },
      },
    ]
    await this.manager.decide('project', 'doc', 'reject', {
      ...this.request,
      change_ids: ['insert', 'delete'],
    })
    expect(this.doc.lines).to.deep.equal(['foo bar baz'])
    expect(this.doc.ranges.changes).to.have.length(0)
  })

  it('rejects stale versions without applying anything', async function () {
    await expect(
      this.manager.decide('project', 'doc', 'reject', {
        ...this.request,
        version: 3,
      })
    ).to.be.rejectedWith('Document changed')
    expect(this.UpdateManager.promises.applyUpdate).not.to.have.been.called
  })

  it('denies a reviewer accepting suggestions or rejecting another author', async function () {
    await expect(
      this.manager.decide('project', 'doc', 'accept', {
        ...this.request,
        own_only: true,
      })
    ).to.be.rejectedWith('cannot accept')
    this.doc.ranges.changes[0].metadata.user_id = OTHER
    await expect(
      this.manager.decide('project', 'doc', 'reject', {
        ...this.request,
        own_only: true,
      })
    ).to.be.rejectedWith('only reject their own')
    expect(this.UpdateManager.promises.applyUpdate).not.to.have.been.called
  })

  for (const type of ['insert', 'delete']) {
    for (const action of ['accept', 'reject']) {
      it(`${action}s a History OT ${type} with actual editor-core operations`, async function () {
        const raw = suggested('foo bar', 3, 4, type)
        this.doc = { ...this.doc, type: 'history-ot', lines: raw }
        await this.manager.decide('project', 'doc', action, {
          version: 4,
          user_id: USER,
          own_only: false,
          changes: [selector(raw)],
        })
        const shouldRemove = (action === 'accept') === (type === 'delete')
        expect(this.doc.lines.content).to.equal(
          shouldRemove ? 'foo' : 'foo bar'
        )
        expect(this.doc.lines.trackedChanges || []).to.have.length(0)
      })
    }
  }

  it('rejects a History OT replacement without changing surrounding text', async function () {
    const raw = suggested('foo quuxbar baz', 4, 4, 'insert')
    raw.trackedChanges.push({
      range: { pos: 8, length: 3 },
      tracking: { type: 'delete', userId: USER, ts: TS },
    })
    this.doc = { ...this.doc, type: 'history-ot', lines: raw }
    await this.manager.decide('project', 'doc', 'reject', {
      version: 4,
      user_id: USER,
      own_only: true,
      changes: [selector(raw, 1), selector(raw)],
    })
    expect(this.doc.lines.content).to.equal('foo bar baz')
    expect(this.doc.lines.trackedChanges || []).to.have.length(0)
  })

  it('validates History OT authorship and exact selectors under the lock', async function () {
    const raw = suggested('foo bar', 3, 4, 'insert', OTHER)
    this.doc = { ...this.doc, type: 'history-ot', lines: raw }
    const body = {
      version: 4,
      user_id: USER,
      own_only: true,
      changes: [selector(raw)],
    }
    await expect(
      this.manager.decide('project', 'doc', 'reject', body)
    ).to.be.rejectedWith('only reject their own')
    body.changes[0].user_id = USER
    await expect(
      this.manager.decide('project', 'doc', 'reject', body)
    ).to.be.rejectedWith('Suggestions changed')
    expect(this.HistoryOT.applyUpdate).not.to.have.been.called
  })
})

describe('review security policy', function () {
  const change = {
    id: 'a',
    op: { p: 4, i: 'foo' },
    metadata: { user_id: OTHER, ts: TS },
  }
  it('rejects duplicate and nonexistent ids', function () {
    expect(() => selectChanges([change], ['a', 'a'], false, USER)).to.throw(
      'distinct'
    )
    expect(() => selectChanges([change], ['missing'], false, USER)).to.throw(
      'refresh'
    )
  })
  it('permits splitting a protected insertion around a reviewer suggestion', function () {
    expect(() =>
      assertProtectedChanges(
        [change],
        [
          { ...change, op: { p: 4, i: 'f' } },
          { ...change, op: { p: 8, i: 'oo' } },
        ],
        USER
      )
    ).not.to.throw()
  })
  it('permits position shifts while protecting another author content and provenance', function () {
    expect(() =>
      assertProtectedChanges(
        [change],
        [{ ...change, op: { ...change.op, p: 8 } }],
        USER
      )
    ).not.to.throw()
    expect(() => assertProtectedChanges([change], [], USER)).to.throw(
      'another author'
    )
    expect(() =>
      assertProtectedChanges(
        [change],
        [{ ...change, op: { p: 4, i: 'fo' } }],
        USER
      )
    ).to.throw('another author')
    expect(() =>
      assertProtectedChanges(
        [change],
        [{ ...change, metadata: { ...change.metadata, user_id: USER } }],
        USER
      )
    ).to.throw('another author')
  })
})
