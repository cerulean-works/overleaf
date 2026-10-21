import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import { AdminDashboard } from '@/features/server-admin/components/admin-dashboard'

renderInReactLayout('server-admin-root', () => <AdminDashboard />)
