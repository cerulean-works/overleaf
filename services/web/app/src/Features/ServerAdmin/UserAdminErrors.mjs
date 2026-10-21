export class UserAdminError extends Error {
  constructor(message, statusCode = 409) {
    super(message)
    this.name = 'UserAdminError'
    this.statusCode = statusCode
  }
}
