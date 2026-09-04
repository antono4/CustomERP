import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../config/db.js';
import { loadModuleAccess } from '../middleware/auth.js';

const router = Router();

/** GET /login — tampilkan form login AdminLTE */
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile('login.html', { root: 'public' });
});

/** POST /login — validasi kredensial + muat akses modul ke session */
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';

  try {
    const user = await queryOne(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.email,
              u.is_active, u.role_id, r.code AS role_code, r.name AS role_name, r.level AS role_level
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.username = ? AND u.is_active = 1`,
      [username],
    );
    const ok = user ? await bcrypt.compare(password ?? '', user.password_hash) : false;

    if (!ok) {
      await query(
        `INSERT INTO login_logs (username, ip_address, user_agent, success) VALUES (?, ?, ?, 0)`,
        [username ?? '', ip, req.headers['user-agent']?.slice(0, 255) ?? ''],
      );
      return res.status(401).render?.('login', { error: 'Username atau password salah' }) ??
        res.status(401).json({ error: 'Invalid username or password' });
    }

    const moduleAccess = await loadModuleAccess(user.id, user.role_id);
    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      roleId: user.role_id,
      roleCode: user.role_code,
      roleName: user.role_name,
      roleLevel: user.role_level,
      moduleAccess,
    };
    await query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);
    await query(
      `INSERT INTO login_logs (username, ip_address, user_agent, success) VALUES (?, ?, ?, 1)`,
      [user.username, ip, req.headers['user-agent']?.slice(0, 255) ?? ''],
    );

    if (req.accepts('html')) {
      return res.redirect('/');
    }
    return res.json({ message: 'Login berhasil', user: req.session.user });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /logout — bersihkan session */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('[auth] logout error:', err);
    res.clearCookie('nexus.sid');
    res.redirect('/login');
  });
});

/** GET /api/auth/me — data session terautentikasi (untuk fetch berbasis JS\) */
router.get('/api/auth/me', requireAuthForMe, (req, res) => {
  res.json({ user: req.session.user });
});

function requireAuthForMe(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export default router;