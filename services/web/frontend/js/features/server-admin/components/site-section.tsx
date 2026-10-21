import type { FormEvent, ReactNode } from 'react'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'

function AdminForm({
  action,
  confirmation,
  children,
}: {
  action: string
  confirmation?: string
  children: ReactNode
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmation && !window.confirm(confirmation)) {
      event.preventDefault()
    }
  }

  return (
    <form action={action} method="POST" onSubmit={handleSubmit}>
      <input type="hidden" name="_csrf" value={getMeta('ol-csrfToken')} />
      {children}
    </form>
  )
}

export function SiteSection() {
  const { systemMessages, openSockets, editorIsOpen } =
    getMeta('ol-serverAdmin')

  return (
    <div className="server-admin-site-grid">
      <div id="system-messages" className="server-admin-card">
        <h3>System messages</h3>
        <p>Post a message visible to everyone on this server.</p>
        {systemMessages.length > 0 ? (
          <ul className="server-admin-messages">
            {systemMessages.map((message, index) => (
              <li key={message._id ?? index}>{message.content}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No active system messages.</p>
        )}
        <AdminForm action="/admin/messages">
          <OLFormLabel htmlFor="system-message">Message</OLFormLabel>
          <OLFormControl
            id="system-message"
            name="content"
            type="text"
            required
          />
          <OLButton className="mt-3" type="submit">
            Post message
          </OLButton>
        </AdminForm>
        {systemMessages.length > 0 && (
          <AdminForm
            action="/admin/messages/clear"
            confirmation="Clear all system messages?"
          >
            <OLButton className="mt-3" variant="secondary" type="submit">
              Clear all messages
            </OLButton>
          </AdminForm>
        )}
      </div>
      <div id="open-close-editor" className="server-admin-card">
        <h3>Editor access</h3>
        <p>
          The editor is currently{' '}
          <strong>{editorIsOpen ? 'open' : 'closed'}</strong>.
        </p>
        <p className="text-muted">
          Closing the editor prevents new sessions. Existing sessions remain
          connected until you disconnect them.
        </p>
        <div className="server-admin-actions">
          <AdminForm
            action={editorIsOpen ? '/admin/closeEditor' : '/admin/openEditor'}
            confirmation={
              editorIsOpen
                ? 'Close the editor for everyone on this server?'
                : undefined
            }
          >
            <OLButton
              type="submit"
              variant={editorIsOpen ? 'danger' : 'primary'}
            >
              {editorIsOpen ? 'Close editor' : 'Reopen editor'}
            </OLButton>
          </AdminForm>
          <AdminForm
            action="/admin/disconnectAllUsers"
            confirmation="Disconnect all active editor sessions?"
          >
            <OLButton type="submit" variant="danger">
              Disconnect all users
            </OLButton>
          </AdminForm>
        </div>
        {editorIsOpen && (
          <p className="small text-muted mt-3 mb-0">
            Close the editor before disconnecting everyone to prevent immediate
            reconnections.
          </p>
        )}
      </div>
      <details
        id="open-sockets"
        className="server-admin-card server-admin-diagnostics"
      >
        <summary>Connection diagnostics</summary>
        {Object.keys(openSockets).length === 0 ? (
          <p className="text-muted mt-3 mb-0">No open outbound connections.</p>
        ) : (
          <ul className="mt-3 mb-0">
            {Object.entries(openSockets).map(([url, paths]) => (
              <li key={url}>
                <strong>{url}</strong> ({paths.length})
                <ul>
                  {paths.map((path, index) => (
                    <li key={index}>{path}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
