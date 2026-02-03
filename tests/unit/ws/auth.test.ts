import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'crypto';

// Implementations for TDD
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

interface AuthServer {
  passwordHash: string;
  createChallenge: () => string;
  validateResponse: (response: string) => { valid: boolean; sessionToken?: string };
}

interface AuthClient {
  password: string;
  createResponse: (challenge: string) => string;
}

function createAuthServer(password: string): AuthServer {
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

function createAuthClient(password: string): AuthClient {
  return {
    password,
    createResponse: (challenge: string) => {
      const combined = challenge + password;
      return challenge + ':' + hashPassword(combined);
    }
  };
}

// Tests
describe('Password Authentication', () => {
  it('should hash password with SHA256', () => {
    const password = 'mySecret123';
    const hash = hashPassword(password);
    
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA256 hex = 64 chars
    expect(hash).not.toBe(password);
  });
  
  it('should verify correct password', () => {
    const password = 'mySecret123';
    const hash = hashPassword(password);
    
    expect(verifyPassword(password, hash)).toBe(true);
  });
  
  it('should reject wrong password', () => {
    const password = 'mySecret123';
    const hash = hashPassword(password);
    
    expect(verifyPassword('wrongPassword', hash)).toBe(false);
  });
});

describe('Session Token', () => {
  it('should generate session token', () => {
    const token = generateSessionToken();
    
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(20);
  });
  
  it('should generate unique tokens', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();
    
    expect(token1).not.toBe(token2);
  });
});

describe('Auth Handshake', () => {
  it('should create challenge for handshake', () => {
    const server = createAuthServer('password123');
    const challenge = server.createChallenge();
    
    expect(challenge).toBeDefined();
    expect(challenge.length).toBeGreaterThan(10);
  });
  
  it('should validate handshake response', () => {
    const server = createAuthServer('password123');
    const client = createAuthClient('password123');
    
    const challenge = server.createChallenge();
    const response = client.createResponse(challenge);
    const result = server.validateResponse(response);
    
    expect(result.valid).toBe(true);
    expect(result.sessionToken).toBeDefined();
  });
  
  it('should reject wrong password in handshake', () => {
    const server = createAuthServer('correctPassword');
    const client = createAuthClient('wrongPassword');
    
    const challenge = server.createChallenge();
    const response = client.createResponse(challenge);
    const result = server.validateResponse(response);
    
    expect(result.valid).toBe(false);
    expect(result.sessionToken).toBeUndefined();
  });
});
