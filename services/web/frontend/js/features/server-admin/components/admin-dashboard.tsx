import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useScrollToIdOnLoad from '@/shared/hooks/use-scroll-to-id-on-load'
import { SiteSection } from './site-section'
import { UsersSection } from './users-section'
import { ProjectsSection } from './projects-section'

export function AdminDashboard() {
  const { isReady } = useWaitForI18n()
  useScrollToIdOnLoad()

  if (!isReady) {
    return null
  }

  return (
    <div className="container-fluid server-admin-dashboard">
      <header className="server-admin-header">
        <div>
          <h1>Admin panel</h1>
          <p className="text-muted mb-0">
            Manage your site, user invitations, and server projects.
          </p>
        </div>
        <nav aria-label="Admin panel sections" className="server-admin-nav">
          <a href="#site">Site</a>
          <a href="#users">Users</a>
          <a href="#projects">Projects</a>
        </nav>
      </header>
      <section
        id="site"
        aria-labelledby="admin-site-heading"
        className="server-admin-section"
      >
        <h2 id="admin-site-heading">Site</h2>
        <SiteSection />
      </section>
      <section
        id="users"
        aria-labelledby="admin-users-heading"
        className="server-admin-section"
      >
        <h2 id="admin-users-heading">Users</h2>
        <UsersSection />
      </section>
      <section
        id="projects"
        aria-labelledby="admin-projects-heading"
        className="server-admin-section"
      >
        <h2 id="admin-projects-heading">Projects</h2>
        <ProjectsSection />
      </section>
    </div>
  )
}
