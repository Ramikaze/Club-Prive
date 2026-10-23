// Business errors carry an HTTP status, a stable code for the client and a French message.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const invalid = (message, code = 'INVALIDE', details) => new AppError(400, code, message, details);
export const forbidden = (message = 'Action réservée à un administrateur.') => new AppError(403, 'INTERDIT', message);
export const notSignedIn = () => new AppError(401, 'NON_CONNECTE', 'Session expirée : veuillez vous reconnecter.');
export const notFound = (what = 'Élément') => new AppError(404, 'INTROUVABLE', `${what} introuvable.`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
