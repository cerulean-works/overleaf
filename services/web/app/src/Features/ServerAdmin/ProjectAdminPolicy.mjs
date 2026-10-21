export const isObjectId = value =>
  typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)

export function parseProjectQuery(query) {
  const allowed = new Set(['q', 'owner', 'userId', 'page', 'pageSize'])
  if (Object.keys(query).some(key => !allowed.has(key)))
    throw new Error('Unknown query parameter')
  const { q = '', owner = '', userId = '', page = '1', pageSize = '25' } = query
  if (
    [q, owner, userId, page, pageSize].some(value => typeof value !== 'string')
  )
    throw new Error('Invalid query parameter')
  if (q.length > 200 || owner.length > 200 || (userId && !isObjectId(userId)))
    throw new Error('Invalid search')
  if (!/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(pageSize))
    throw new Error('Invalid pagination')
  const parsedPage = Number(page)
  const parsedSize = Number(pageSize)
  if (
    !Number.isSafeInteger(parsedPage) ||
    parsedPage > 1000000 ||
    parsedSize > 100
  )
    throw new Error('Invalid pagination')
  return {
    q: q.trim(),
    owner: owner.trim(),
    userId,
    page: parsedPage,
    pageSize: parsedSize,
  }
}

export function literalSearch(value) {
  return {
    $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    $options: 'i',
  }
}

export function buildProjectPipeline(query, objectId) {
  const pipeline = []
  if (query.userId) {
    const id = objectId(query.userId)
    pipeline.push({
      $match: {
        $or: [
          'owner_ref',
          'collaberator_refs',
          'reviewer_refs',
          'readOnly_refs',
          'tokenAccessReadOnly_refs',
          'tokenAccessReadAndWrite_refs',
        ].map(field => ({ [field]: id })),
      },
    })
  }
  // Bound directory working sets before lookup and sorting.
  pipeline.push({
    $project: {
      name: 1,
      owner_ref: 1,
      lastUpdated: 1,
      archived: 1,
      trashed: 1,
    },
  })
  pipeline.push(
    {
      $lookup: {
        from: 'users',
        localField: 'owner_ref',
        foreignField: '_id',
        pipeline: [{ $project: { email: 1, first_name: 1, last_name: 1 } }],
        as: 'owner',
      },
    },
    { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } }
  )
  if (query.q) {
    const search = literalSearch(query.q)
    const alternatives = [
      { name: search },
      { 'owner.email': search },
      { 'owner.first_name': search },
      { 'owner.last_name': search },
    ]
    if (isObjectId(query.q))
      alternatives.push(
        { _id: objectId(query.q) },
        { owner_ref: objectId(query.q) }
      )
    pipeline.push({ $match: { $or: alternatives } })
  }
  if (query.owner) {
    pipeline.push({
      $match: isObjectId(query.owner)
        ? { owner_ref: objectId(query.owner) }
        : { 'owner.email': literalSearch(query.owner) },
    })
  }
  pipeline.push({
    $facet: {
      count: [{ $count: 'total' }],
      items: [
        { $sort: { lastUpdated: -1, _id: -1 } },
        { $skip: (query.page - 1) * query.pageSize },
        { $limit: query.pageSize },
        {
          $project: {
            name: 1,
            owner_ref: 1,
            owner: 1,
            lastUpdated: 1,
            archived: 1,
            trashed: 1,
          },
        },
      ],
    },
  })
  return pipeline
}

export function projectDto(project) {
  const ownerId = project.owner_ref?.toString()
  return {
    id: project._id.toString(),
    name: project.name || 'Untitled project',
    owner: project.owner
      ? {
          id: project.owner._id.toString(),
          email: project.owner.email || '',
          name: [project.owner.first_name, project.owner.last_name]
            .filter(Boolean)
            .join(' '),
        }
      : null,
    lastUpdated: project.lastUpdated?.toISOString() || null,
    archivedByOwner:
      Array.isArray(project.archived) &&
      project.archived.some(id => id.toString() === ownerId),
    trashedByOwner:
      Array.isArray(project.trashed) &&
      project.trashed.some(id => id.toString() === ownerId),
  }
}
