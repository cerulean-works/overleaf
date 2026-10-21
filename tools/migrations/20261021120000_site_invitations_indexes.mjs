import Helpers from './lib/helpers.mjs'

const indexes = [
  // A deleted account's invitation history must not prevent inviting a new
  // account with the same address later. Creation is serialized by email.
  { key: { email: 1 }, name: 'email_1' },
  { key: { userId: 1 }, name: 'userId_1', unique: true },
  { key: { createdAt: -1, _id: -1 }, name: 'createdAt_-1__id_-1' },
]

export default {
  tags: ['server-ce', 'server-pro'],
  async migrate({ db }) {
    await Helpers.addIndexesToCollection(db.siteInvitations, indexes)
  },
  async rollback({ db }) {
    await Helpers.dropIndexesFromCollection(db.siteInvitations, indexes)
  },
}
