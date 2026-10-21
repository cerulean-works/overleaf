import { expect } from 'chai'
import sinon from 'sinon'
import { render, screen, within } from '@testing-library/react'
import { AdminDashboard } from '@/features/server-admin/components/admin-dashboard'

describe('<AdminDashboard />', function () {
  let fetchStub: sinon.SinonStub

  beforeEach(function () {
    window.metaAttributesCache.set('ol-serverAdmin', {
      systemMessages: [],
      openSockets: {},
      editorIsOpen: true,
    })
    fetchStub = sinon.stub(globalThis, 'fetch').resolves({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    } as Response)
  })

  afterEach(function () {
    fetchStub.restore()
  })

  it('shows Site, Users, and Projects together with working section links', async function () {
    render(<AdminDashboard />)
    await screen.findByRole('heading', { name: 'Admin panel' })
    const navigation = screen.getByRole('navigation', {
      name: 'Admin panel sections',
    })

    for (const name of ['Site', 'Users', 'Projects']) {
      const region = screen.getByRole('region', { name })
      const link = within(navigation).getByRole('link', { name })
      expect(region.id).to.equal(name.toLowerCase())
      expect(link.getAttribute('href')).to.equal(`#${region.id}`)
    }

    await screen.findByText('No projects match this search.')
    expect(fetchStub.callCount).to.equal(3)
  })
})
