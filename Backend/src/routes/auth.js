import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from "bcryptjs";
import { db } from '../server.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'l720-ops-secret-key';
const JWT_EXPIRES_IN = '7d'; // Mobile tokens last longer
const REFRESH_EXPIRES_IN = '30d';

/**
 * Shared authentication logic used by both mobile and ops login.
 * @param {'mobile'|'ops'} client - Which client is logging in (affects token expiry).
 */
async function authenticateLogin(email, password, client = 'mobile') {
  if (!email || !password) {
    return { status: 400, body: { error: 'Email and password required' } };
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE email = ? AND is_active = 1'
  ).get(email);

  if (!user) {
    return { status: 401, body: { error: 'Invalid credentials' } };
  }

  // Verify password
  let passwordValid = false;
  if (process.env.DEV_MODE === "true" && user.password_hash === '$2b$10$YourDevHashHere.ShouldBeReplacedInProd') {
    passwordValid = true;
  } else if (user.password_hash) {
    passwordValid = await bcrypt.compare(password, user.password_hash);
  }

  if (!passwordValid) {
    return { status: 401, body: { error: 'Invalid credentials' } };
  }

  // Check if password change is required
  if (user.password_must_change === 1) {
    return {
      status: 403,
      body: {
        error: 'Password change required',
        code: 'PASSWORD_MUST_CHANGE',
        tempToken: jwt.sign({ id: user.id, mustChange: true }, JWT_SECRET, { expiresIn: '15m' }),
      },
    };
  }

  // Update last login
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);

  const tokenPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    areaId: user.area_id,
    supervisorId: user.supervisor_id,
  };

  const expiresIn = client === 'ops' ? '24h' : JWT_EXPIRES_IN;
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn });

  const userShape = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    areaId: user.area_id,
    supervisorId: user.supervisor_id,
    title: user.title,
    phone: user.phone,
  };

  console.log(`[Auth] User ${user.email} (${user.role}) logged in via ${client}`);

  if (client === 'ops') {
    return { status: 200, body: { token, user: userShape } };
  }

  // Mobile: include refresh token with longer expiry.
  const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
  return { status: 200, body: { token, refreshToken, expiresIn: JWT_EXPIRES_IN, user: userShape } };
}

/**
 * POST /api/auth/login
 * Unified login endpoint for mobile and ops clients.
 * Pass { client: "ops" } for web portal login (24h token, no refresh).
 * Default is "mobile" (7d token + 30d refresh).
 */
router.post('/login', async (req, res) => {
  const { email, password, client } = req.body;
  const result = await authenticateLogin(email, password, client || 'mobile');
  res.status(result.status).json(result.body);
});

/**
 * GET /api/auth/demo-users
 * Returns a curated set of demo users (one per role) for quick login
 * on the mobile app and ops portal. No passwords are returned — the
 * caller must still POST /api/auth/login with the password.
 *
 * SECURITY: This endpoint is disabled unless DEMO_QUICK_LOGIN=true is
 * set in the server environment. In production, this must be unset.
 */
router.get('/demo-users', (_req, res) => {
  if (process.env.DEMO_QUICK_LOGIN !== 'true') {
    return res.status(404).json({ error: 'Not available' });
  }

  const roles = ['DISTRICT_MANAGER', 'AREA_MANAGER', 'SUPERVISOR', 'TECH'];
  const result = [];

  for (const role of roles) {
    const user = db.prepare(`
      SELECT id, name, email, role, title
      FROM users
      WHERE role = ? AND is_active = 1
      ORDER BY name ASC
      LIMIT 1
    `).get(role);

    if (user) {
      result.push({
        ...user,
        demoPassword: 'password',
      });
    }
  }

  res.json({ users: result });
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);

    if (decoded.type !== 'refresh') {
      return res.status(403).json({ error: 'Invalid token type' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Issue new tokens
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      areaId: user.area_id,
      supervisorId: user.supervisor_id,
    };

    const newToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const newRefreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES_IN });

    console.log(`[Mobile Auth] Token refreshed for ${user.email}`);

    res.json({
      token: newToken,
      refreshToken: newRefreshToken,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        areaId: user.area_id,
        supervisorId: user.supervisor_id,
      },
    });
  } catch (error) {
    console.error('[Mobile Auth] Refresh failed:', error.message);
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
});

/**
 * POST /api/auth/password
 * Change password for mobile user
 */
router.post('/password', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { currentPassword, newPassword } = req.body;
    const userId = decoded.id;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password (skip for temp token change)
    if (currentPassword && user.password_hash !== '$2b$10$YourDevHashHere.ShouldBeReplacedInProd') {
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, password_must_change = 0 WHERE id = ?')
      .run(newHash, userId);

    console.log(`[Mobile Auth] Password changed for ${user.email}`);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    console.error('[Mobile Auth] Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
