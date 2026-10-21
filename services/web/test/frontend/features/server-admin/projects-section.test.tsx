import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectsSection } from '@/features/server-admin/components/projects-section'

describe('<ProjectsSection />', function () {
  let fetchStub: sinon.SinonStub
  const project = {
    id: '0123456789abcdef01234567',
    name: 'Another owner’s paper',
    owner: { id: 'owner', email: 'owner@example.com', name: 'Owner' },
    lastUpdated: null,
    archivedByOwner: true,
    trashedByOwner: false,
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, 'fetch')
    fetchStub.resolves({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        items: [project],
        total: 26,
        page: 1,
        pageSize: 25,
      }),
    } as Response)
  })
  afterEach(function () {
    fetchStub.restore()
  })

  it('shows unrelated server projects and their owner archive state', async function () {
    render(<ProjectsSection />)
    await screen.findByText('Another owner’s paper')
    screen.getByText('owner@example.com')
    screen.getByText('Archived')
    expect(
      screen.getByRole('link', { name: 'Open' }).getAttribute('href')
    ).to.equal(`/project/${project.id}`)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(fetchStub.lastCall.args[0]).to.include('page=2'))
  })

  it('loads collaborator details while keeping the owner immutable', async function () {
    render(<ProjectsSection />)
    await screen.findByText('Another owner’s paper')
    fetchStub.resolves({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        ...project,
        members: [
          {
            id: 'owner',
            email: 'owner@example.com',
            name: 'Owner',
            privilegeLevel: 'owner',
          },
          {
            id: 'reader',
            email: 'reader@example.com',
            name: 'Reader',
            privilegeLevel: 'readOnly',
          },
        ],
        invitations: [],
      }),
    } as Response)
    fireEvent.click(screen.getByRole('button', { name: 'Manage access' }))
    await screen.findByRole('heading', {
      name: 'Access to Another owner’s paper',
    })
    expect(
      screen.queryByRole('combobox', {
        name: 'Permission for owner@example.com',
      })
    ).to.equal(null)
    screen.getByRole('combobox', { name: 'Permission for reader@example.com' })
    expect(screen.getAllByRole('button', { name: 'Remove' })).to.have.length(1)
  })

  it('renders failed directory requests as an actionable error', async function () {
    fetchStub.rejects(new Error('unavailable'))
    render(<ProjectsSection />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(fetchStub.callCount).to.equal(2))
  })
})
