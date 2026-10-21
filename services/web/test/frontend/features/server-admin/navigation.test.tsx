import { expect } from 'chai'
import { render, screen } from '@testing-library/react'
import { AccountMenuItems } from '@/shared/components/navbar/account-menu-items'
import Footer from '@/shared/components/footer/footer'
import getMeta from '@/utils/meta'

describe('Community Edition navigation', function () {
  beforeEach(function () {
    Object.assign(getMeta('ol-ExposedSettings'), {
      env: 'server-ce',
      isOverleaf: false,
    })
    window.metaAttributesCache.set('ol-navbar', { canDisplayAdminMenu: true })
  })

  function renderAccountMenu() {
    return render(
      <ul role="menu">
        <AccountMenuItems
          sessionUser={{ email: 'admin@example.com' }}
          showSubscriptionLink={false}
        />
      </ul>
    )
  }

  it('links to the unified admin panel from Account', function () {
    renderAccountMenu()
    expect(
      screen.getByRole('menuitem', { name: 'Admin panel' }).getAttribute('href')
    ).to.equal('/admin')
  })

  it('does not expose admin navigation to ordinary users', function () {
    getMeta('ol-navbar').canDisplayAdminMenu = false
    renderAccountMenu()
    expect(screen.queryByRole('menuitem', { name: 'Admin panel' })).to.not.exist
  })

  it('links the configured source repository from Account', function () {
    getMeta('ol-navbar').sourceUrl = 'https://example.com/source'
    renderAccountMenu()
    expect(
      screen.getByRole('menuitem', { name: 'Source code' }).getAttribute('href')
    ).to.equal('https://example.com/source')
  })

  it('renders no Community Edition footer or empty footer wrapper', function () {
    const { container } = render(
      <Footer
        showThinFooter
        showPoweredBy
        translatedLanguages={{}}
        rightItems={[{ text: 'Fork on GitHub!' }]}
      />
    )
    expect(container.childElementCount).to.equal(0)
  })
})
