export interface AuthenticatedIdentity {
  organizationId: string
  userId?: string
  requestId: string
  externalSubject?: string
}

export interface RequestWithIdentity {
  headers: Record<string, string | string[] | undefined>
  pacificpowerIdentity?: AuthenticatedIdentity
}
