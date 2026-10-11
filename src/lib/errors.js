// An error with an HTTP status; the HTTP layer turns it into { status: 'error', message }.
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => { throw new AppError(status, message); };
