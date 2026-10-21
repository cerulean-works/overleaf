/* global db, rs, sleep, quit, print */

// Existing replica sets are left intact. Only initialize a new database.
try {
  const config = rs.conf()
  if (config._id !== 'overleaf') {
    throw new Error('Expected the MongoDB replica set to be named overleaf')
  }
} catch (error) {
  if (error.code !== 94 && error.codeName !== 'NotYetInitialized') {
    throw error
  }
  const result = rs.initiate({
    _id: 'overleaf',
    members: [{ _id: 0, host: 'mongo:27017' }],
  })
  if (!result.ok) {
    throw new Error(
      `MongoDB replica-set initialization failed: ${result.errmsg}`
    )
  }
}

for (let attempt = 0; attempt < 60; attempt++) {
  if (db.hello().isWritablePrimary) {
    print('MongoDB replica set is writable.')
    quit(0)
  }
  sleep(1000)
}

throw new Error('MongoDB did not elect a writable primary within 60 seconds')
