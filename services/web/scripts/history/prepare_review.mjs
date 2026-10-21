import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'

export function parseArgs(args) {
  const result = {
    apply: false,
    all: false,
    projectIds: [],
    continueOnError: false,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--apply') result.apply = true
    else if (arg === '--all') result.all = true
    else if (arg === '--continue-on-error') result.continueOnError = true
    else if (arg === '--project-id') {
      const id = args[++i]
      if (!/^[a-f0-9]{24}$/i.test(id || ''))
        throw new Error('Invalid --project-id')
      result.projectIds.push(id)
    } else if (arg === '--report') {
      result.reportPath = args[++i]
      if (!result.reportPath || result.reportPath.startsWith('--'))
        throw new Error('Expected --report path')
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (result.all === result.projectIds.length > 0) {
    throw new Error('Choose --all or one or more --project-id values')
  }
  return result
}

export async function prepareProjects(projects, options, dependencies) {
  const report = { dryRun: !options.apply, results: [], failed: 0 }
  for await (const project of projects) {
    const id = project._id.toString()
    const beforeStage = project.overleaf?.history?.otMigrationStage ?? 0
    const entry = { projectId: id, otMigrationStage: beforeStage }
    try {
      if (!project.overleaf?.history?.id)
        throw new Error(
          'Project has no full history; repair history before enabling review'
        )
      if (project.overleaf.history.rangesSupportEnabled) {
        entry.status = 'ready'
      } else if (!options.apply) {
        entry.status = (await dependencies.hasRanges(id))
          ? 'would-resync'
          : 'would-enable'
      } else {
        const result = await dependencies.prepare(id)
        const after = await dependencies.getProject(id)
        if (!after?.overleaf?.history?.rangesSupportEnabled)
          throw new Error('Range support was not enabled')
        if ((after.overleaf.history.otMigrationStage ?? 0) !== beforeStage)
          throw new Error('OT stage changed unexpectedly')
        entry.status = 'prepared'
        entry.migrationType = result.migrationType
      }
    } catch (error) {
      entry.status = 'failed'
      entry.error = error.message
      report.failed++
    }
    report.results.push(entry)
    if (entry.status === 'failed' && !options.continueOnError) break
  }
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  // This standalone CLI owns stdout. Shared app modules print startup and
  // migration diagnostics; keep the machine-readable report separate.
  console.log = console.error
  process.env.UV_THREADPOOL_SIZE ||= '16'
  const { default: logger } = await import('@overleaf/logger')
  logger.initialize('prepare-review', {
    streams: [
      { level: process.env.LOG_LEVEL || 'info', stream: process.stderr },
    ],
  })
  const execute = async () => {
    const { db, ObjectId } =
      await import('../../app/src/infrastructure/mongodb.mjs')
    const { default: DocstoreManager } =
      await import('../../app/src/Features/Docstore/DocstoreManager.mjs')
    const Migration = options.apply
      ? (
          await import('../../app/src/Features/History/HistoryRangesSupportMigration.mjs')
        ).default
      : undefined
    const query = options.all
      ? {}
      : { _id: { $in: options.projectIds.map(id => new ObjectId(id)) } }
    const projects = db.projects
      .find(query, { projection: { _id: 1, overleaf: 1 } })
      .sort({ _id: 1 })
    const report = await prepareProjects(projects, options, {
      hasRanges: id => DocstoreManager.promises.projectHasRanges(id),
      prepare: id => Migration.promises.processProject(id, 'forwards', false),
      getProject: id =>
        db.projects.findOne(
          { _id: new ObjectId(id) },
          { projection: { overleaf: 1 } }
        ),
    })
    if (options.projectIds.length) {
      const found = new Set(report.results.map(entry => entry.projectId))
      for (const id of options.projectIds) {
        if (!found.has(id) && !report.failed) {
          report.results.push({
            projectId: id,
            status: 'failed',
            error: 'Project not found',
          })
          report.failed++
        }
      }
    }
    const output = JSON.stringify(report, null, 2) + '\n'
    if (options.reportPath) await writeFile(options.reportPath, output)
    await new Promise((resolve, reject) =>
      process.stdout.write(output, error => (error ? reject(error) : resolve()))
    )
    if (report.failed) process.exitCode = 1
  }
  if (options.apply) {
    const { scriptRunner } = await import('../lib/ScriptRunner.mjs')
    await scriptRunner(execute)
  } else await execute()
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => process.exit(process.exitCode || 0))
    .catch(error => {
      process.stderr.write(error.message + '\n', () => process.exit(1))
    })
}
