import { db, ObjectId } from '../../infrastructure/mongodb.mjs'
import { expressify } from '@overleaf/promise-utils'
import {
  buildProjectPipeline,
  isObjectId,
  parseProjectQuery,
  projectDto,
} from './ProjectAdminPolicy.mjs'

async function list(req, res) {
  res.set('Cache-Control', 'no-store')
  let query
  try {
    query = parseProjectQuery(req.query)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
  const [result] = await db.projects
    .aggregate(buildProjectPipeline(query, value => new ObjectId(value)))
    .toArray()
  res.json({
    items: (result?.items || []).map(projectDto),
    total: result?.count[0]?.total || 0,
    page: query.page,
    pageSize: query.pageSize,
  })
}

async function details(req, res) {
  res.set('Cache-Control', 'no-store')
  if (!isObjectId(req.params.Project_id))
    return res.status(400).json({ message: 'Invalid project ID' })
  const id = new ObjectId(req.params.Project_id)
  const project = await db.projects.findOne(
    { _id: id },
    {
      projection: {
        name: 1,
        owner_ref: 1,
        lastUpdated: 1,
        archived: 1,
        trashed: 1,
        collaberator_refs: 1,
        reviewer_refs: 1,
        readOnly_refs: 1,
        tokenAccessReadOnly_refs: 1,
        tokenAccessReadAndWrite_refs: 1,
      },
    }
  )
  if (!project) return res.sendStatus(404)
  const memberRoles = new Map()
  const linkMembers = new Set()
  for (const [field, role] of [
    ['tokenAccessReadOnly_refs', 'readOnly'],
    ['tokenAccessReadAndWrite_refs', 'readAndWrite'],
  ]) {
    for (const userId of project[field] || []) {
      memberRoles.set(userId.toString(), role)
      linkMembers.add(userId.toString())
    }
  }
  for (const [field, role] of [
    ['readOnly_refs', 'readOnly'],
    ['reviewer_refs', 'review'],
    ['collaberator_refs', 'readAndWrite'],
  ]) {
    for (const userId of project[field] || []) {
      memberRoles.set(userId.toString(), role)
      linkMembers.delete(userId.toString())
    }
  }
  if (project.owner_ref) {
    memberRoles.set(project.owner_ref.toString(), 'owner')
    linkMembers.delete(project.owner_ref.toString())
  }
  const [users, invitations] = await Promise.all([
    db.users
      .find(
        {
          _id: {
            $in: [...memberRoles.keys()].map(value => new ObjectId(value)),
          },
        },
        { projection: { email: 1, first_name: 1, last_name: 1 } }
      )
      .toArray(),
    db.projectInvites
      .find(
        { projectId: id, expires: { $gt: new Date() } },
        { projection: { email: 1, privileges: 1 } }
      )
      .toArray(),
  ])
  project.owner = users.find(
    user => user._id.toString() === project.owner_ref?.toString()
  )
  res.json({
    ...projectDto(project),
    members: users.map(user => ({
      id: user._id.toString(),
      email: user.email || '',
      name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      privilegeLevel: memberRoles.get(user._id.toString()),
      ...(linkMembers.has(user._id.toString()) ? { accessSource: 'link' } : {}),
    })),
    invitations: invitations.map(invite => ({
      id: invite._id.toString(),
      email: invite.email,
      privilegeLevel: invite.privileges,
    })),
  })
}

export default { list: expressify(list), details: expressify(details) }
