import { FormEvent, useCallback, useEffect, useState } from 'react'
import {
  AdminPage,
  AdminUser,
  SiteInvitation,
} from '../../../../../types/server-admin'
import {
  getJSON,
  postJSON,
  patchJSON,
  FetchError,
} from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import getMeta from '@/utils/meta'

const PAGE_SIZE = 25

function errorMessage(error: unknown) {
  return error instanceof FetchError
    ? error.getUserFacingMessage()
    : 'The request failed. Please try again.'
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function Pagination({
  page,
  total,
  onPage,
  disabled,
}: {
  page: number
  total: number
  onPage: (page: number) => void
  disabled: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="d-flex align-items-center gap-3 mt-3">
      <OLButton
        variant="secondary"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </OLButton>
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <OLButton
        variant="secondary"
        size="sm"
        disabled={disabled || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </OLButton>
    </div>
  )
}

export function UsersSection() {
  const [users, setUsers] = useState<AdminPage<AdminUser>>()
  const [invitations, setInvitations] = useState<AdminPage<SiteInvitation>>()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [suspended, setSuspended] = useState('')
  const [page, setPage] = useState(1)
  const [invitationPage, setInvitationPage] = useState(1)
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [manualLink, setManualLink] = useState<{
    email: string
    url: string
    expiresAt: string
  }>()
  const [revision, setRevision] = useState(0)
  const currentUserId = getMeta('ol-user_id') || getMeta('ol-user')?.id

  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const abort = new AbortController()
    const userParams = new URLSearchParams({
      q: search,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (role) userParams.set('role', role)
    if (suspended) userParams.set('suspended', suspended)
    const invitationParams = new URLSearchParams({
      q: search,
      page: String(invitationPage),
      pageSize: String(PAGE_SIZE),
    })
    setLoading(true)
    setLoadError('')
    Promise.all([
      getJSON<AdminPage<AdminUser>>(`/admin/api/users?${userParams}`, {
        signal: abort.signal,
      }),
      getJSON<AdminPage<SiteInvitation>>(
        `/admin/api/invitations?${invitationParams}`,
        { signal: abort.signal }
      ),
    ])
      .then(([userResult, invitationResult]) => {
        setUsers(userResult)
        setInvitations(invitationResult)
        setLoading(false)
      })
      .catch(error => {
        if (!abort.signal.aborted) {
          setLoadError(errorMessage(error))
          setLoading(false)
        }
      })
    return () => abort.abort()
  }, [search, page, invitationPage, role, suspended, revision])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function submitInvitations(event: FormEvent) {
    event.preventDefault()
    const addresses = [...new Set(emails.split(/[\s,;]+/).filter(Boolean))]
    perform(async () => {
      const result = await postJSON<{
        results: Array<{
          email: string
          status: string
          error?: string
          invitation?: SiteInvitation
        }>
      }>('/admin/api/invitations', { body: { emails: addresses } })
      const failures = result.results.filter(item => item.status === 'error')
      const deliveryFailures = result.results.filter(
        item => item.invitation?.deliveryStatus === 'failed'
      )
      const unsent = result.results.filter(
        item => item.invitation?.deliveryStatus === 'not_sent'
      )
      const created = result.results.length - failures.length
      setNotice(
        `${created} invitation${created === 1 ? '' : 's'} created.${deliveryFailures.length ? ` Email delivery failed for ${deliveryFailures.length}; copy a new link below.` : ''}${unsent.length ? ` Email is not configured for ${unsent.length}; create a new link below to invite them manually.` : ''}`
      )
      if (failures.length)
        setError(failures.map(item => `${item.email}: ${item.error}`).join(' '))
      setEmails(failures.map(item => item.email).join(', '))
    })
  }

  function changeUser(
    user: AdminUser,
    changes: { isAdmin?: boolean; suspended?: boolean }
  ) {
    const action =
      changes.isAdmin !== undefined
        ? changes.isAdmin
          ? 'make an administrator'
          : 'make a member'
        : changes.suspended
          ? 'suspend'
          : 'restore'
    if (
      !window.confirm(
        `${action.charAt(0).toUpperCase() + action.slice(1)} ${user.email}? Their current sessions will be signed out.`
      )
    )
      return
    perform(async () => {
      await patchJSON(`/admin/api/users/${user.id}`, { body: changes })
      setNotice(`Permissions updated for ${user.email}.`)
    })
  }

  function invitationAction(
    invitation: SiteInvitation,
    action: 'resend' | 'revoke' | 'link'
  ) {
    if (
      action === 'revoke' &&
      !window.confirm(
        `Revoke the invitation for ${invitation.email}? Existing invitation links will stop working.`
      )
    )
      return
    perform(async () => {
      if (action === 'link') {
        const result = await postJSON<{ url: string; expiresAt: string }>(
          `/admin/api/invitations/${invitation.id}/link`,
          { body: {} }
        )
        setManualLink({ email: invitation.email, ...result })
        setNotice(
          'A new invitation link is ready. Previous links no longer work.'
        )
      } else {
        const result = await postJSON<SiteInvitation>(
          `/admin/api/invitations/${invitation.id}/${action}`,
          { body: {} }
        )
        setManualLink(undefined)
        if (result.deliveryStatus === 'failed' && action === 'resend') {
          setError(
            result.deliveryError ||
              'Email delivery failed. Copy a new invitation link instead.'
          )
        } else if (
          result.deliveryStatus === 'not_sent' &&
          action === 'resend'
        ) {
          setNotice(
            `Invitation renewed for ${invitation.email}. Email is not configured; create a new link to invite them manually.`
          )
        } else {
          setNotice(
            action === 'resend'
              ? `Invitation sent to ${invitation.email}.`
              : `Invitation revoked for ${invitation.email}.`
          )
        }
      }
    })
  }

  return (
    <div>
      <p>
        Manage accounts, administrator access, and invitations to this server.
      </p>
      {(error || loadError) && (
        <Notification
          type="error"
          content={error || loadError}
          className="mb-3"
        />
      )}
      {notice && (
        <Notification type="success" content={notice} className="mb-3" />
      )}
      <OLForm onSubmit={submitInvitations} className="mb-4">
        <OLFormLabel htmlFor="admin-invitation-emails">
          Invite users
        </OLFormLabel>
        <div className="d-flex flex-wrap gap-2">
          <OLFormControl
            id="admin-invitation-emails"
            value={emails}
            onChange={event => setEmails(event.target.value)}
            placeholder="alice@example.com, bob@example.com"
            required
            disabled={busy}
            aria-describedby="admin-invitation-help"
          />
          <OLButton
            type="submit"
            disabled={busy || !emails.trim()}
            isLoading={busy}
          >
            Send invitations
          </OLButton>
        </div>
        <p id="admin-invitation-help" className="text-muted mt-2">
          Separate emails with commas or spaces. Invitations expire after seven
          days. Existing accounts are kept as they are.
        </p>
      </OLForm>

      <OLForm
        onSubmit={event => {
          event.preventDefault()
          setSearch(query)
          setPage(1)
          setInvitationPage(1)
        }}
        className="d-flex flex-wrap align-items-end gap-3 mb-4"
      >
        <div>
          <OLFormLabel htmlFor="admin-user-search">
            Search users and invitations
          </OLFormLabel>
          <OLFormControl
            id="admin-user-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Name, email, or user ID"
          />
        </div>
        <div>
          <OLFormLabel htmlFor="admin-user-role">Role</OLFormLabel>
          <select
            className="form-select"
            id="admin-user-role"
            value={role}
            onChange={event => {
              setRole(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All roles</option>
            <option value="admin">Administrator</option>
            <option value="member">Member</option>
          </select>
        </div>
        <div>
          <OLFormLabel htmlFor="admin-user-state">Account state</OLFormLabel>
          <select
            className="form-select"
            id="admin-user-state"
            value={suspended}
            onChange={event => {
              setSuspended(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All accounts</option>
            <option value="false">Active</option>
            <option value="true">Suspended</option>
          </select>
        </div>
        <OLButton type="submit" variant="secondary" disabled={busy}>
          Search
        </OLButton>
      </OLForm>
      {loading && <p role="status">Loading users and invitations…</p>}

      <h3>Users</h3>
      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>Email and name</th>
              <th>Role</th>
              <th>State</th>
              <th>Invitation</th>
              <th>Joined / last login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users?.items.map(user => (
              <tr key={user.id}>
                <td>
                  {user.email}
                  <div className="text-muted">
                    {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                  </div>
                </td>
                <td>{user.isAdmin ? 'Administrator' : 'Member'}</td>
                <td>{user.suspended ? 'Suspended' : 'Active'}</td>
                <td>
                  {user.invitationStatus === 'legacy'
                    ? 'Legacy / untracked'
                    : user.invitationStatus}
                </td>
                <td>
                  {date(user.signUpDate)}
                  <div className="text-muted">{date(user.lastLoggedIn)}</div>
                </td>
                <td>
                  <div className="d-flex flex-wrap gap-2">
                    <a
                      href={`/admin?userId=${encodeURIComponent(user.id)}#projects`}
                    >
                      Projects
                    </a>
                    <OLButton
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy ||
                        user.id === currentUserId ||
                        (!user.isAdmin &&
                          user.invitationStatus !== 'legacy' &&
                          user.invitationStatus !== 'accepted')
                      }
                      onClick={() =>
                        changeUser(user, { isAdmin: !user.isAdmin })
                      }
                    >
                      {user.isAdmin ? 'Make member' : 'Make administrator'}
                    </OLButton>
                    <OLButton
                      size="sm"
                      variant={user.suspended ? 'secondary' : 'danger'}
                      disabled={busy || user.id === currentUserId}
                      onClick={() =>
                        changeUser(user, { suspended: !user.suspended })
                      }
                    >
                      {user.suspended ? 'Restore account' : 'Suspend'}
                    </OLButton>
                  </div>
                </td>
              </tr>
            ))}
            {users && !users.items.length && (
              <tr>
                <td colSpan={6}>No users match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {users && (
        <Pagination
          page={page}
          total={users.total}
          onPage={setPage}
          disabled={busy || loading}
        />
      )}
      <p className="text-muted mt-2">
        Untracked accounts predate invitation tracking. Their inviter and
        acceptance date are unknown.
      </p>

      <h3 className="mt-4">Invitations</h3>
      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Invited by</th>
              <th>Status</th>
              <th>Delivery</th>
              <th>Created / expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations?.items.map(invitation => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>{invitation.invitedBy?.email || 'Unknown'}</td>
                <td>{invitation.status}</td>
                <td>
                  {invitation.deliveryStatus.replace('_', ' ')}
                  <div className="text-muted">
                    {date(invitation.lastSentAt)}
                  </div>
                  {invitation.deliveryError && (
                    <div>{invitation.deliveryError}</div>
                  )}
                </td>
                <td>
                  {date(invitation.createdAt)}
                  <div className="text-muted">{date(invitation.expiresAt)}</div>
                </td>
                <td>
                  {invitation.status !== 'accepted' && (
                    <div className="d-flex flex-wrap gap-2">
                      <OLButton
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => invitationAction(invitation, 'resend')}
                      >
                        Resend
                      </OLButton>
                      <OLButton
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => invitationAction(invitation, 'link')}
                      >
                        Create new link
                      </OLButton>
                      <OLButton
                        size="sm"
                        variant="danger"
                        disabled={busy || invitation.status === 'revoked'}
                        onClick={() => invitationAction(invitation, 'revoke')}
                      >
                        Revoke
                      </OLButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {invitations && !invitations.items.length && (
              <tr>
                <td colSpan={6}>No invitations match this search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {invitations && (
        <Pagination
          page={invitationPage}
          total={invitations.total}
          onPage={setInvitationPage}
          disabled={busy || loading}
        />
      )}
      {manualLink && (
        <div className="mt-3">
          <OLFormLabel htmlFor="admin-manual-invitation-link">
            New invitation link for {manualLink.email}
          </OLFormLabel>
          <OLFormControl
            id="admin-manual-invitation-link"
            value={manualLink.url}
            readOnly
            onFocus={event => event.target.select()}
          />
          <p>
            Expires {date(manualLink.expiresAt)}. Copy this link and send it to
            the invited user.
          </p>
        </div>
      )}
    </div>
  )
}
