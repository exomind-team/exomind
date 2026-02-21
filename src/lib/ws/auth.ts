import { createHash, randomBytes } from 'crypto';

/**
 * Hash password using SHA256
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Verify password against hash
 */
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/**
 * Generate random session token
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Auth server for challenge-response handshake
 */
export interface AuthServer {
  passwordHash: string;
  createChallenge: () => string;
  validateResponse: (response: string) => { valid: boolean; sessionToken?: string };
}

/**
 * Auth client for challenge-response handshake
 */
export interface AuthClient {
  password: string;
  createResponse: (challenge: string) => string;
}

/**
 * Create auth server instance
 */
export function createAuthServer(password: string): AuthServer {
  const passwordHash = hashPassword(password);
  
  return {
    passwordHash,
    createChallenge: () => {
      return randomBytes(16).toString('hex');
    },
    validateResponse: (response: string) => {
      const challenge = response.split(':')[0];
      const clientHash = response.split(':')[1];
      
      if (!challenge || !clientHash) {
        return { valid: false };
      }
      
      // Verify: clientHash should equal hash(challenge + password)
      const expectedHash = hashPassword(challenge + password);
      
      if (clientHash !== expectedHash) {
        return { valid: false };
      }
      
      return {
        valid: true,
        sessionToken: generateSessionToken()
      };
    }
  };
}

/**
 * Create auth client instance
 */
export function createAuthClient(password: string): AuthClient {
  return {
    password,
    createResponse: (challenge: string) => {
      const combined = challenge + password;
      return challenge + ':' + hashPassword(combined);
    }
  };
}
