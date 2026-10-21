export type AdminPage<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type ServerAdminMetadata = {
  systemMessages: Array<{ _id?: string; content: string }>
  openSockets: Record<string, string[]>
  editorIsOpen: boolean
}

export type AdminUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  isAdmin: boolean
  suspended: boolean
  signUpDate: string | null
  lastLoggedIn: string | null
  invitationStatus: 'legacy' | 'pending' | 'accepted' | 'expired' | 'revoked'
}

export type SiteInvitation = {
  id: string
  email: string
  userId: string
  invitedBy: { id: string; email: string } | null
  createdAt: string
  lastSentAt: string | null
  expiresAt: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  deliveryStatus: 'not_sent' | 'sent' | 'failed'
  deliveryError?: string
}

export type AdminProject = {
  id: string
  name: string
  owner: { id: string; email: string; name: string } | null
  lastUpdated: string | null
  archivedByOwner: boolean
  trashedByOwner: boolean
}

export type AdminProjectMember = {
  id: string
  email: string
  name: string
  privilegeLevel: 'owner' | 'readAndWrite' | 'review' | 'readOnly'
  accessSource?: 'link'
}

export type AdminProjectInvitation = {
  id: string
  email: string
  privilegeLevel: 'readAndWrite' | 'review' | 'readOnly'
}

export type AdminProjectDetails = AdminProject & {
  members: AdminProjectMember[]
  invitations: AdminProjectInvitation[]
}
