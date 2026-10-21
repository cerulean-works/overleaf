import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { test } from 'node:test'

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'overleaf-deployment-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function startupScript(name, env) {
  return spawnSync('bash', [join(serverDir, 'init_scripts', name)], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

test('fresh invitation key persists across recreation without appearing in logs', (t) => {
  const root = temporaryDirectory(t)
  const env = {
    OVERLEAF_DATA_DIR: join(root, 'app'),
    OVERLEAF_CONTAINER_ENV_DIR: join(root, 'environment'),
    OVERLEAF_INVITE_TOKEN_SECRET: '',
  }
  const first = startupScript('000_check_missing_secrets.sh', env)
  assert.equal(first.status, 0, first.stderr)
  const secretFile = join(env.OVERLEAF_DATA_DIR, 'secrets/invite-token-secret')
  const key = readFileSync(secretFile, 'utf8')
  assert.match(key.trim(), /^[a-f0-9]{64}$/)
  assert.equal(statSync(secretFile).mode & 0o777, 0o600)
  assert.ok(!first.stdout.includes(key.trim()))

  // A replacement container gets a new environment directory, but the app
  // volume (and therefore its signing key) remains the same.
  rmSync(env.OVERLEAF_CONTAINER_ENV_DIR, { recursive: true })
  const next = startupScript('000_check_missing_secrets.sh', env)
  assert.equal(next.status, 0, next.stderr)
  assert.equal(readFileSync(secretFile, 'utf8'), key)
  assert.equal(
    readFileSync(
      join(env.OVERLEAF_CONTAINER_ENV_DIR, 'OVERLEAF_INVITE_TOKEN_SECRET'),
      'utf8'
    ),
    key
  )
})

test('default session signing key persists and explicit session keys take precedence', (t) => {
  const root = temporaryDirectory(t)
  const env = {
    OVERLEAF_DATA_DIR: join(root, 'app'),
    OVERLEAF_CONTAINER_ENV_DIR: join(root, 'environment'),
    OVERLEAF_INVITE_TOKEN_SECRET: '',
    OVERLEAF_SESSION_SECRET: '',
  }
  assert.equal(startupScript('000_check_missing_secrets.sh', env).status, 0)
  const secretFile = join(env.OVERLEAF_DATA_DIR, 'secrets/session-secret')
  const original = readFileSync(secretFile, 'utf8')
  assert.match(original.trim(), /^[a-f0-9]{64}$/)
  assert.equal(statSync(secretFile).mode & 0o777, 0o600)
  rmSync(env.OVERLEAF_CONTAINER_ENV_DIR, { recursive: true })
  assert.equal(startupScript('000_check_missing_secrets.sh', env).status, 0)
  assert.equal(readFileSync(secretFile, 'utf8'), original)
  assert.equal(
    readFileSync(
      join(env.OVERLEAF_CONTAINER_ENV_DIR, 'OVERLEAF_SESSION_SECRET'),
      'utf8'
    ),
    original
  )

  const explicit = 'existing-session-signing-key'
  const result = startupScript('000_check_missing_secrets.sh', {
    ...env,
    OVERLEAF_SESSION_SECRET: explicit,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.stdout.includes(explicit))
  assert.equal(startupScript('000_check_missing_secrets.sh', env).status, 0)
  assert.equal(readFileSync(secretFile, 'utf8').trim(), explicit)
})

test('explicit invitation secret takes precedence and remains the fallback afterward', (t) => {
  const root = temporaryDirectory(t)
  const env = {
    OVERLEAF_DATA_DIR: join(root, 'app'),
    OVERLEAF_CONTAINER_ENV_DIR: join(root, 'environment'),
    OVERLEAF_INVITE_TOKEN_SECRET: '',
  }
  assert.equal(startupScript('000_check_missing_secrets.sh', env).status, 0)
  const explicit = 'existing-deployment-signing-key'
  const result = startupScript('000_check_missing_secrets.sh', {
    ...env,
    OVERLEAF_INVITE_TOKEN_SECRET: explicit,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.stdout.includes(explicit))
  assert.equal(startupScript('000_check_missing_secrets.sh', env).status, 0)
  assert.equal(
    readFileSync(
      join(env.OVERLEAF_DATA_DIR, 'secrets/invite-token-secret'),
      'utf8'
    ).trim(),
    explicit
  )
})

function texliveFixture(
  t,
  { marker = '2026/x86_64-linux/basic-v1', release = '2026' } = {}
) {
  const root = temporaryDirectory(t)
  const texRoot = join(root, 'texlive')
  const binary = join(texRoot, '2026/bin/x86_64-linux/tlmgr')
  mkdirSync(dirname(binary), { recursive: true })
  writeFileSync(join(root, 'baseline'), '2026/x86_64-linux/basic-v1\n')
  writeFileSync(join(texRoot, '.overleaf-baseline'), `${marker}\n`)
  writeFileSync(
    binary,
    `#!/bin/bash
case "$*" in
  --version) echo 'TeX Live (https://tug.org/texlive) version ${release}' ;;
  'path add') echo refreshed >> "$TEXLIVE_TEST_LOG" ;;
  *) exit 99 ;;
esac
`
  )
  chmodSync(binary, 0o755)
  return {
    root,
    texRoot,
    binary,
    env: {
      OVERLEAF_TEXLIVE_ROOT: texRoot,
      OVERLEAF_TEXLIVE_BASELINE_FILE: join(root, 'baseline'),
      TEXLIVE_TEST_LOG: join(root, 'path-add.log'),
    },
  }
}

test('matching TeX volume restores command symlinks on every startup', (t) => {
  const fixture = texliveFixture(t)
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = startupScript('110_check_texlive_volume.sh', fixture.env)
    assert.equal(result.status, 0, result.stderr)
  }
  assert.equal(
    readFileSync(fixture.env.TEXLIVE_TEST_LOG, 'utf8'),
    'refreshed\nrefreshed\n'
  )
})

for (const marker of [
  '2025/x86_64-linux/basic-v1',
  '2026/aarch64-linux/basic-v1',
  '2026/x86_64-linux/basic-v2',
]) {
  test(`incompatible TeX marker ${marker} is rejected without changing the volume`, (t) => {
    const fixture = texliveFixture(t, { marker })
    const result = startupScript('110_check_texlive_volume.sh', fixture.env)
    assert.equal(result.status, 101)
    assert.match(result.stderr, /does not match/)
    assert.ok(!existsSync(fixture.env.TEXLIVE_TEST_LOG))
    assert.equal(
      readFileSync(join(fixture.texRoot, '.overleaf-baseline'), 'utf8').trim(),
      marker
    )
  })
}

test('a matching marker does not hide a wrong installed TeX release', (t) => {
  const fixture = texliveFixture(t, { release: '2025' })
  const result = startupScript('110_check_texlive_volume.sh', fixture.env)
  assert.equal(result.status, 101)
  assert.match(result.stderr, /installed TeX Live release/)
  assert.ok(!existsSync(fixture.env.TEXLIVE_TEST_LOG))
})

test('incomplete TeX volumes fail before startup', (t) => {
  const fixture = texliveFixture(t)
  rmSync(fixture.binary)
  const result = startupScript('110_check_texlive_volume.sh', fixture.env)
  assert.equal(result.status, 101)
  assert.match(result.stderr, /executable is missing/)
})

function initializeMongo({
  existing = false,
  name = 'overleaf',
  primaryAfter = 1,
} = {}) {
  const initiated = []
  let attempts = 0
  const quitSignal = new Error('mongosh quit')
  const context = {
    rs: {
      conf() {
        if (!existing)
          throw Object.assign(new Error('not initialized'), { code: 94 })
        return { _id: name }
      },
      initiate(config) {
        initiated.push(JSON.parse(JSON.stringify(config)))
        return { ok: 1 }
      },
    },
    db: { hello: () => ({ isWritablePrimary: ++attempts >= primaryAfter }) },
    print() {},
    sleep() {},
    quit(code) {
      assert.equal(code, 0)
      throw quitSignal
    },
  }
  try {
    new Script(
      readFileSync(join(serverDir, 'scripts/init-mongo.js'), 'utf8')
    ).runInNewContext(context)
  } catch (error) {
    if (error !== quitSignal) throw error
  }
  return { initiated, attempts }
}

test('fresh MongoDB initializes a replica set and waits for a writable primary', () => {
  const { initiated, attempts } = initializeMongo({ primaryAfter: 3 })
  assert.deepEqual(initiated, [
    { _id: 'overleaf', members: [{ _id: 0, host: 'mongo:27017' }] },
  ])
  assert.equal(attempts, 3)
})

test('existing MongoDB replica set is not initialized or reconfigured again', () => {
  assert.deepEqual(initializeMongo({ existing: true }).initiated, [])
})

test('wrong replica-set name is rejected instead of overwriting an existing configuration', () => {
  assert.throws(
    () => initializeMongo({ existing: true, name: 'different' }),
    /named overleaf/
  )
})

test('MongoDB without a writable primary fails after bounded retries', () => {
  assert.throws(
    () => initializeMongo({ existing: true, primaryAfter: Infinity }),
    /writable primary within 60 seconds/
  )
})
