import { expect } from 'chai'
import sinon from 'sinon'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { UsersSection } from '@/features/server-admin/components/users-section'

const admin = {
  id: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: '',
  isAdmin: true,
  suspended: false,
  signUpDate: null,
  lastLoggedIn: null,
  invitationStatus: 'legacy',
}
const member = {
  ...admin,
  id: 'member',
  email: 'member@example.com',
  firstName: 'Member',
  isAdmin: false,
}
const invitation = {
  id: 'invite',
  email: 'invited@example.com',
  userId: 'invited',
  invitedBy: { id: 'admin', email: admin.email },
  createdAt: '2026-10-21T00:00:00Z',
  lastSentAt: null,
  expiresAt: '2026-10-28T00:00:00Z',
  status: 'pending',
  deliveryStatus: 'not_sent',
}

function json(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => data,
  } as Response
}

describe('<UsersSection />', function () {
  let fetchStub: sinon.SinonStub

  beforeEach(function () {
    window.metaAttributesCache.set('ol-user_id', admin.id)
    // Legacy page navbar metadata includes a name/email but no user ID.
    window.metaAttributesCache.set('ol-user', { email: admin.email })
    sinon.stub(window, 'confirm').returns(true)
    fetchStub = sinon.stub(globalThis, 'fetch')
    fetchStub.callsFake(async path =>
      json(
        path.startsWith('/admin/api/users?')
          ? { items: [admin, member], total: 2, page: 1, pageSize: 25 }
          : { items: [invitation], total: 1, page: 1, pageSize: 25 }
      )
    )
  })

  afterEach(function () {
    fetchStub.restore()
    ;(window.confirm as sinon.SinonStub).restore()
  })

  it('shows user roles, invitation provenance, and project access links', async function () {
    render(<UsersSection />)
    await screen.findByText(member.email)
    expect(screen.getAllByText('Legacy / untracked')).to.have.length(2)
    screen.getByText(
      'Untracked accounts predate invitation tracking. Their inviter and acceptance date are unknown.'
    )
    screen.getByText(invitation.email)
    expect(
      screen.getAllByRole('link', { name: 'Projects' })[1].getAttribute('href')
    ).to.equal('/admin?userId=member#projects')
    const self = screen
      .getAllByText(admin.email, { selector: 'td' })[0]
      .closest('tr')!
    expect(
      (
        within(self).getByRole('button', {
          name: 'Make member',
        }) as HTMLButtonElement
      ).disabled
    ).to.equal(true)
  })

  it('updates account permissions with PATCH and reports success', async function () {
    render(<UsersSection />)
    await screen.findByText(member.email)
    fireEvent.click(screen.getByRole('button', { name: 'Make administrator' }))
    await waitFor(() =>
      expect(
        fetchStub.calledWith(
          '/admin/api/users/member',
          sinon.match({
            method: 'PATCH',
            body: JSON.stringify({ isAdmin: true }),
          })
        )
      ).to.equal(true)
    )
    await screen.findByText(`Permissions updated for ${member.email}.`)
  })

  it('reports partial invitation results and retains failed emails for correction', async function () {
    render(<UsersSection />)
    await screen.findByText(member.email)
    fetchStub.withArgs('/admin/api/invitations').resolves(
      json({
        results: [
          {
            email: 'new@example.com',
            status: 'invited',
            invitation: { ...invitation, deliveryStatus: 'failed' },
          },
          {
            email: 'bad@example.com',
            status: 'error',
            error: 'Already registered.',
          },
        ],
      })
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite users' }), {
      target: { value: 'new@example.com, bad@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitations' }))
    await screen.findByText('bad@example.com: Already registered.')
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Invite users',
        }) as HTMLInputElement
      ).value
    ).to.equal('bad@example.com')
    screen.getByText(
      '1 invitation created. Email delivery failed for 1; copy a new link below.'
    )
  })

  it('only reveals an invitation token after the explicit new-link action', async function () {
    render(<UsersSection />)
    await screen.findByText(invitation.email)
    expect(
      screen.queryByRole('textbox', {
        name: `New invitation link for ${invitation.email}`,
      })
    ).to.equal(null)
    fetchStub.withArgs('/admin/api/invitations/invite/link').resolves(
      json({
        url: 'https://overleaf.example.com/user/activate?token=private',
        expiresAt: invitation.expiresAt,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create new link' }))
    const link = (await screen.findByRole('textbox', {
      name: `New invitation link for ${invitation.email}`,
    })) as HTMLInputElement
    expect(link.value).to.include('token=private')
    expect(link.readOnly).to.equal(true)
    screen.getByText(
      'A new invitation link is ready. Previous links no longer work.'
    )
  })

  it('does not claim delivery when email is disabled during invitation renewal', async function () {
    render(<UsersSection />)
    await screen.findByText(invitation.email)
    fetchStub
      .withArgs('/admin/api/invitations/invite/resend')
      .resolves(json(invitation))
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    await screen.findByText(
      `Invitation renewed for ${invitation.email}. Email is not configured; create a new link to invite them manually.`
    )
    expect(
      screen.queryByText(`Invitation sent to ${invitation.email}.`)
    ).to.equal(null)
  })
})
