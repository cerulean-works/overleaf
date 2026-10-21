import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen } from '@testing-library/react'
import { SiteSection } from '@/features/server-admin/components/site-section'
import getMeta from '@/utils/meta'

describe('<SiteSection />', function () {
  beforeEach(function () {
    window.metaAttributesCache.set('ol-serverAdmin', {
      systemMessages: [{ _id: 'message-1', content: 'Planned maintenance' }],
      openSockets: {},
      editorIsOpen: true,
    })
    window.metaAttributesCache.set('ol-csrfToken', 'test-csrf')
  })

  it('keeps system-message actions and their CSRF tokens', function () {
    const { container } = render(<SiteSection />)
    screen.getByText('Planned maintenance')
    const form = screen
      .getByRole('button', { name: 'Post message' })
      .closest('form')!
    expect(form.getAttribute('action')).to.equal('/admin/messages')
    expect(form.getAttribute('method')).to.equal('POST')
    expect(
      form.querySelector<HTMLInputElement>('input[name="_csrf"]')!.value
    ).to.equal('test-csrf')
    expect(container.querySelector('#system-messages')).to.exist
    expect(
      screen
        .getByRole('button', { name: 'Clear all messages' })
        .closest('form')!
        .getAttribute('action')
    ).to.equal('/admin/messages/clear')
  })

  it('prevents destructive submissions when the confirmation is cancelled', function () {
    const confirmation = sinon.stub(window, 'confirm').returns(false)
    try {
      render(<SiteSection />)
      const form = screen
        .getByRole('button', { name: 'Disconnect all users' })
        .closest('form')!
      expect(fireEvent.submit(form)).to.equal(false)
      expect(confirmation).to.have.been.calledOnce
      expect(form.getAttribute('action')).to.equal('/admin/disconnectAllUsers')
    } finally {
      confirmation.restore()
    }
  })

  it('offers reopening when editor access is closed', function () {
    getMeta('ol-serverAdmin').editorIsOpen = false
    render(<SiteSection />)
    expect(screen.queryByRole('button', { name: 'Close editor' })).to.not.exist
    expect(
      screen
        .getByRole('button', { name: 'Reopen editor' })
        .closest('form')!
        .getAttribute('action')
    ).to.equal('/admin/openEditor')
  })

  it('renders empty states for messages and diagnostics', function () {
    getMeta('ol-serverAdmin').systemMessages = []
    render(<SiteSection />)
    screen.getByText('No active system messages.')
    screen.getByText('No open outbound connections.')
    expect(screen.queryByRole('button', { name: 'Clear all messages' })).to.not
      .exist
  })
})
