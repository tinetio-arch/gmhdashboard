import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest, NextResponse } from 'next/server';
import { getPool, query } from './db';

export type UserRole = 'admin' | 'write' | 'read';

export type UserRecord = {
  user_id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string | null;
  is_active: boolean;
  is_provider: boolean;
  can_sign: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicUser = Pick<
  UserRecord,
  'user_id' | 'email' | 'role' | 'display_name' | 'created_at' | 'updated_at' | 'is_active' | 'is_provider' | 'can_sign'
>;

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

const ROLE_PRIORITY: Record<UserRole, number> = {
  read: 1,
  write: 2,
  admin: 3
};

export const SESSION_COOKIE_NAME = 'gmh_session';
const SESSION_TTL_HOURS = 12;

function ensureSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not configured.');
  }
  return secret;
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHmac('sha256', ensureSessionSecret()).update(rawToken).digest('hex');
}

function generateSessionToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

function getExpiryDate(): Date {
  return new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
}

export function userHasRole(user: PublicUser, requiredRole: UserRole): boolean {
  return ROLE_PRIORITY[user.role] >= ROLE_PRIORITY[requiredRole];
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createUser({
  email,
  password,
  role,
  displayName,
  isProvider = false,
  canSign = false
}: {
  email: string;
  password: string;
  role: UserRole;
  displayName?: string | null;
  isProvider?: boolean;
  canSign?: boolean;
}): Promise<PublicUser> {
  const passwordHash = await hashPassword(password);
  const [record] = await query<UserRecord>(
    `INSERT INTO users (email, password_hash, role, display_name, is_provider, can_sign)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING user_id, email, role, display_name, is_active, is_provider, can_sign, created_at, updated_at, password_hash`,
    [email.trim().toLowerCase(), passwordHash, role, displayName ?? null, isProvider, canSign]
  );
  if (!record) {
    throw new Error('Failed to create user');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, ...rest } = record;
  return rest;
}

export async function updateUserRole(userId: string, role: UserRole): Promise<void> {
  await query('UPDATE users SET role = $2 WHERE user_id = $1', [userId, role]);
}

export async function deleteUser(userId: string): Promise<void> {
  await query('DELETE FROM users WHERE user_id = $1', [userId]);
}

export async function listUsers(): Promise<PublicUser[]> {
  const records = await query<UserRecord>(
    `SELECT user_id, email, role, display_name, is_active, is_provider, can_sign, created_at, updated_at, password_hash
       FROM users
      ORDER BY created_at DESC`
  );
  return records.map(({ password_hash: _hash, ...rest }) => rest);
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $2 WHERE user_id = $1', [userId, passwordHash]);
}

export async function updateUserDisplayName(userId: string, displayName: string | null): Promise<void> {
  await query('UPDATE users SET display_name = $2 WHERE user_id = $1', [userId, displayName ?? null]);
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  await query('UPDATE users SET email = $2 WHERE user_id = $1', [userId, email.trim().toLowerCase()]);
}

export async function updateUserProviderFlag(userId: string, isProvider: boolean): Promise<void> {
  await query('UPDATE users SET is_provider = $2 WHERE user_id = $1', [userId, isProvider]);
}

export async function updateUserSigningFlag(userId: string, canSign: boolean): Promise<void> {
  await query('UPDATE users SET can_sign = $2 WHERE user_id = $1', [userId, canSign]);
}

export async function changePasswordWithCurrent(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const record = await getUserById(userId);
  if (!record) {
    return false;
  }
  const matches = await verifyPassword(currentPassword, record.password_hash);
  if (!matches) {
    return false;
  }
  await updateUserPassword(userId, newPassword);
  await revokeSessionsForUser(userId);
  return true;
}

export async function countActiveAdmins(): Promise<number> {
  const [row] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM users
      WHERE role = 'admin'
        AND is_active = TRUE`
  );
  return Number(row?.count ?? 0);
}

async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const [record] = await query<UserRecord>(
    `SELECT *
       FROM users
      WHERE email = $1
        AND is_active = TRUE`,
    [email.trim().toLowerCase()]
  );
  return record ?? null;
}

async function getUserById(userId: string): Promise<UserRecord | null> {
  const [record] = await query<UserRecord>(
    `SELECT *
       FROM users
      WHERE user_id = $1
        AND is_active = TRUE`,
    [userId]
  );
  return record ?? null;
}

export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = generateSessionToken();
  const hashedToken = hashSessionToken(token);
  const expires = getExpiryDate();
  await query(
    `INSERT INTO sessions (user_id, session_token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashedToken, expires]
  );
  return { token, expires };
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  const hashedToken = hashSessionToken(rawToken);
  await query('DELETE FROM sessions WHERE session_token = $1', [hashedToken]);
}

export async function revokeSessionsForUser(userId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

async function getSession(rawToken: string): Promise<{ user: PublicUser; expires_at: Date } | null> {
  const hashedToken = hashSessionToken(rawToken);
  const [record] = await query<
    {
      session_token: string;
      expires_at: Date;
      user_id: string;
      email: string;
      role: UserRole;
      display_name: string | null;
      is_active: boolean;
      is_provider: boolean;
      can_sign: boolean;
      created_at: string;
      updated_at: string;
    }
  >(
    `SELECT s.session_token,
            s.expires_at,
            u.user_id,
            u.email,
            u.role,
            u.display_name,
            u.is_active,
            u.is_provider,
            u.can_sign,
            u.created_at,
            u.updated_at
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
      WHERE s.session_token = $1
        AND s.expires_at > NOW()
        AND u.is_active = TRUE`,
    [hashedToken]
  );

  if (!record) {
    return null;
  }

  const { session_token: _sessionToken, ...rest } = record;
  const { expires_at, ...userInfo } = rest;
  return { user: userInfo, expires_at };
}

export function setSessionCookie(response: NextResponse, token: string, expires: Date): void {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const cookiePath = basePath || '/';
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: cookiePath,
    expires
  });
}

export function clearSessionCookie(response: NextResponse): void {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const cookiePath = basePath || '/';
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: cookiePath
  });
}

async function getUserFromCookies(): Promise<PublicUser | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  const session = await getSession(token);
  if (!session) {
    return null;
  }
  return session.user;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  return getUserFromCookies();
}

export async function requireUser(minRole: UserRole = 'read'): Promise<PublicUser> {
  const user = await getUserFromCookies();
  if (!user) {
    redirect('/login');
  }
  if (!userHasRole(user, minRole)) {
    redirect('/unauthorized');
  }
  return user;
}

export async function requireApiUser(request: NextRequest, minRole: UserRole = 'read'): Promise<PublicUser> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new UnauthorizedError();
  }
  const session = await getSession(token);
  if (!session) {
    throw new UnauthorizedError();
  }
  if (!userHasRole(session.user, minRole)) {
    throw new UnauthorizedError('Forbidden');
  }
  return session.user;
}

export function getSessionTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function invalidateExpiredSessions(): Promise<void> {
  await query('DELETE FROM sessions WHERE expires_at <= NOW()');
}

export async function authenticateUser(email: string, password: string): Promise<PublicUser | null> {
  const user = await getUserByEmail(email);
  if (!user) {
    return null;
  }
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return null;
  }
  const { password_hash: _hash, ...rest } = user;
  return rest;
}

export async function ensureAdminExists({
  email,
  password,
  displayName
}: {
  email: string;
  password: string;
  displayName?: string | null;
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<UserRecord>('SELECT * FROM users WHERE role = $1 LIMIT 1', ['admin']);
    if (existing.rows.length === 0) {
      const passwordHash = await hashPassword(password);
      await client.query(
        `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, $2, 'admin', $3)`,
        [email.trim().toLowerCase(), passwordHash, displayName ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

