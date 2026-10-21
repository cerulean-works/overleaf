import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  deleteJSON,
  getJSON,
  postJSON,
  putJSON,
} from '@/infrastructure/fetch-json'
import type {
  AdminPage,
  AdminProject,
  AdminProjectDetails,
  AdminProjectMember,
} from '../../../../../types/server-admin'

const roles = [
  ['readAndWrite', 'Editor'],
  ['review', 'Reviewer'],
  ['readOnly', 'Viewer'],
] as const
type Role = Exclude<AdminProjectMember['privilegeLevel'], 'owner'>

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Unknown'
}

export function ProjectsSection() {
  const initialUserId =
    new URLSearchParams(window.location.search).get('userId') || ''
  const [userId, setUserId] = useState(initialUserId)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [reload, setReload] = useState(0)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AdminPage<AdminProject>>()
  const [selected, setSelected] = useState<AdminProjectDetails>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('readOnly')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      q: search,
      page: String(page),
      pageSize: '25',
    })
    if (userId) params.set('userId', userId)
    getJSON<AdminPage<AdminProject>>(`/admin/api/projects?${params}`, {
      signal: controller.signal,
    })
      .then(result => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load projects. Please try again.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [search, page, userId, reload])

  const openDetails = useCallback(async (id: string) => {
    setError('')
    setBusy(true)
    try {
      setSelected(
        await getJSON<AdminProjectDetails>(`/admin/api/projects/${id}`)
      )
    } catch {
      setError('Could not load project details.')
    } finally {
      setBusy(false)
    }
  }, [])

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (selected)
        setSelected(
          await getJSON<AdminProjectDetails>(
            `/admin/api/projects/${selected.id}`
          )
        )
      setNotice(message)
    } catch {
      setError('The change could not be saved. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function searchProjects(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setSearch(query.trim())
    setReload(value => value + 1)
  }

  function invite(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    void mutate(async () => {
      const result = await postJSON<{ error?: string; invite?: unknown }>(
        `/admin/api/projects/${selected.id}/invite`,
        { body: { email, privileges: inviteRole } }
      )
      if (result?.error || !result?.invite) throw new Error('Invitation failed')
      setEmail('')
    }, 'Project invitation created.')
  }

  return (
    <>
      <p className="text-muted">
        Every project on this server. Archive and trash status below refer to
        the owner.
      </p>
      {userId && (
        <p>
          Showing projects accessible to user <code>{userId}</code>.{' '}
          <button
            className="btn btn-link"
            onClick={() => {
              setUserId('')
              setPage(1)
            }}
          >
            Show all projects
          </button>
        </p>
      )}
      <form onSubmit={searchProjects} className="d-flex gap-2 mb-3">
        <label htmlFor="admin-project-search" className="visually-hidden">
          Search server projects
        </label>
        <input
          id="admin-project-search"
          className="form-control"
          type="search"
          maxLength={200}
          placeholder="Search by project name, ID, or owner"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={loading}>
          Search
        </button>
      </form>
      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="alert alert-success">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading projects…</p>}
      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Owner</th>
              <th>Last modified</th>
              <th>Owner status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map(project => (
              <tr key={project.id}>
                <td>
                  {project.name}
                  <br />
                  <small>
                    <code>{project.id}</code>
                  </small>
                </td>
                <td>{project.owner?.email || 'Owner unavailable'}</td>
                <td>{displayDate(project.lastUpdated)}</td>
                <td>
                  {project.trashedByOwner
                    ? 'In trash'
                    : project.archivedByOwner
                      ? 'Archived'
                      : 'Active'}
                </td>
                <td>
                  <div className="d-flex gap-2">
                    <a
                      className="btn btn-secondary btn-sm"
                      href={`/project/${project.id}`}
                    >
                      Open
                    </a>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => void openDetails(project.id)}
                    >
                      Manage access
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && data?.items.length === 0 && (
        <p>No projects match this search.</p>
      )}
      {data && (
        <div className="d-flex align-items-center gap-3 mb-3">
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 1 || loading}
            onClick={() => setPage(value => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} · {data.total} projects
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page * data.pageSize >= data.total || loading}
            onClick={() => setPage(value => value + 1)}
          >
            Next
          </button>
        </div>
      )}
      {selected && (
        <div className="card mt-3">
          <div className="card-body">
            <div className="d-flex align-items-start justify-content-between gap-3">
              <h3>Access to {selected.name}</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setSelected(undefined)}
              >
                Close details
              </button>
            </div>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Permission</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.members.map(member => (
                    <tr key={member.id}>
                      <td>
                        {member.name || member.email}
                        <br />
                        <small>
                          {member.email}
                          {member.accessSource === 'link'
                            ? ' · Sharing link'
                            : ''}
                        </small>
                      </td>
                      <td>
                        {member.privilegeLevel === 'owner' ? (
                          'Owner'
                        ) : (
                          <select
                            aria-label={`Permission for ${member.email}`}
                            className="form-select"
                            disabled={busy}
                            value={member.privilegeLevel}
                            onChange={event =>
                              void mutate(
                                () =>
                                  putJSON(
                                    `/admin/api/projects/${selected.id}/users/${member.id}`,
                                    {
                                      body: {
                                        privilegeLevel: event.target.value,
                                      },
                                    }
                                  ),
                                'Permission updated.'
                              )
                            }
                          >
                            {roles.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {member.privilegeLevel !== 'owner' && (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                () =>
                                  deleteJSON(
                                    `/admin/api/projects/${selected.id}/users/${member.id}`
                                  ),
                                'Collaborator removed.'
                              )
                            }
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected.members.some(
              member => member.accessSource === 'link'
            ) && (
              <p className="text-muted">
                Changing a sharing-link member’s permission adds them as a named
                collaborator. Removing them does not disable the sharing link;
                manage sharing links in the project’s Share menu.
              </p>
            )}
            <h4>Pending project invitations</h4>
            {selected.invitations.length === 0 ? (
              <p>No pending project invitations.</p>
            ) : (
              <ul>
                {selected.invitations.map(invitation => (
                  <li key={invitation.id} className="mb-2">
                    {invitation.email} ·{' '}
                    {
                      roles.find(
                        ([value]) => value === invitation.privilegeLevel
                      )?.[1]
                    }{' '}
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            postJSON(
                              `/admin/api/projects/${selected.id}/invite/${invitation.id}/resend`
                            ),
                          'Invitation renewed.'
                        )
                      }
                    >
                      Resend
                    </button>{' '}
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            deleteJSON(
                              `/admin/api/projects/${selected.id}/invite/${invitation.id}`
                            ),
                          'Invitation revoked.'
                        )
                      }
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={invite} className="row g-2 align-items-end">
              <div className="col-md-6">
                <label
                  className="form-label"
                  htmlFor="admin-project-invite-email"
                >
                  Invite collaborator
                </label>
                <input
                  id="admin-project-invite-email"
                  className="form-control"
                  type="email"
                  required
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label
                  className="form-label"
                  htmlFor="admin-project-invite-role"
                >
                  Permission
                </label>
                <select
                  id="admin-project-invite-role"
                  className="form-select"
                  value={inviteRole}
                  onChange={event => setInviteRole(event.target.value as Role)}
                >
                  {roles.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={busy}
                >
                  Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
