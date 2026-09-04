import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../../config/db.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

/** Helper: row tunggal */
async function one(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] ?? null;
}

/** GET /api/users  daftar user (filter role/status/pencarian) */
router.get('/', async (req, res) => {
  const { q, role, status } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (role) { where.push('u.role_id = ?'); params.push(role); }
  if (status !== undefined && status !== '') { where.push('u.is_active = ?'); params.push(Number(status)); }
  const rows = await pool.execute(
    `SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.last_login_at,
            u.role_id, r.name AS role_name, r.level AS role_level,
            DATE_FORMAT(u.created_at, '%d/%m/%Y') AS created_at
       FROM users u JOIN roles r ON r.id = u.role_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.created_at DESC`,
    params,
  );
  res.json({ success: true, data: rows[0], total: rows[0].length });
});

/** GET /api/users/roles  role reference */
router.get('/roles', async (_req, res) => {
  const [rows] = await pool.execute('SELECT id, code, name, level FROM roles ORDER BY level DESC');
  res.json({ success: true, data: rows });
});

/** POST /api/users  create user */
router.post('/', async (req, res) => {
  const { username, full_name, email, role_id, password, is_active = 1 } = req.body ?? {};
  const conn = await pool.getConnection();
  try {
    if (!username || !full_name || !password || !role_id) {
      return res.status(400).json({ success: false, error: 'Username, nama lengkap, role, dan password wajib diisi' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
    }
    const dup = await one('SELECT id FROM users WHERE username = ?', [username]);
    if (dup) return res.status(409).json({ success: false, error: 'Username sudah dipakai' });
    const role = await one('SELECT id, level FROM roles WHERE id = ?', [role_id]);
    if (!role) return res.status(400).json({ success: false, error: 'Role tidak valid' });
    if (role.level > (req.session.user.role_level ?? 0)) {
      return res.status(403).json({ success: false, error: 'Anda tidak boleh membuat user dengan level lebih tinggi' });
    }
    const hash = await bcrypt.hash(password, 12);
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `INSERT INTO users (username, password_hash, full_name, email, role_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, full_name ?? '', email ?? null, role_id, Number(is_active) ?? 1, hash],
    );
    await conn.commit();
    res.status(201).json({ success: true, message: 'User berhasil dibuat', data: { id: r.insertId } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Username atau email sudah dipakai' });
    }
    res.status(500).json({ success: false, error: 'Gagal membuat user' });
  } finally {
    conn.release();
  }
});

/** PATCH /api/users/:id  update profil + opsi ganti password */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, email, role_id, is_active, password } = req.body ?? {};
  const user = await one('SELECT id, username FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
  const fieldSets = [];
  const params = [];
  if (full_name !== undefined) { fieldSets.push('full_name = ?'); params.push(full_name); }
  if (email !== undefined) { fieldSets.push('email = ?'); params.push(email ?? null); }
  if (role_id !== undefined) {
    const role = await one('SELECT id, level FROM roles WHERE id = ?', [role_id]);
    if (!role) return res.status(400).json({ success: false, error: 'Role tidak valid' });
    if (role.level > (req.session.user.role_level ?? 0)) {
      return res.status(403).json({ success: false, error: 'Anda tidak boleh memberi role lebih tinggi dari level anda' });
    }
    fieldSets.push('role_id = ?'); params.push(role_id);
  }
  if (is_active !== undefined) { fieldSets.push('is_active = ?'); params.push(Number(is_active)); }
  if (password) {
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
    const hash = await bcrypt.hash(password, 12);
    fieldSets.push('password_hash = ?'); params.push(hash);
  }
  if (!fieldSets.length) return res.status(400).json({ success: false, error: 'Tidak ada data yang diubah' });
  params.push(id);
  await pool.execute(`UPDATE users SET ${fieldSets.join(', ')} WHERE id = ?`, params);
  res.json({ success: true, message: 'User berhasil diperbarui' });
});

/** PATCH /api/users/:id/toggle  aktif/nonaktif */
router.patch('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const user = await one('SELECT id, is_active, username FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
  if (req.session.user.username === user.username) {

    return res.status(400).json({ success: false, error: 'Anda tidak dapat menonaktifkan akun sendiri' });
  }
  const next = user.is_active ? 0 : 1;
  await pool.execute('UPDATE users SET is_active = ? WHERE id = ?', [next, id]);
  res.json({ success: true, message: `Status user diubah menjadi ${next ? 'Aktif' : 'Nonaktif'}` });
});

/** DELETE /api/users/:id  hapus user (hanya superadmin bisa hapus admin; soft=nonaktif) */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const user = await one(
    'SELECT u.id, u.username, u.role_id, r.level AS role_level FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [id],
  );
  if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
  if (req.session.user.username === user.username) {

    return res.status(400).json({ success: false, error: 'Tidak dapat menghapus akun sendiri' });
  }
  if (user.role_level >= (req.session.user.role_level ?? 0) && user.username !== req.session.user.username) {



    return res.status(403).json({ success: false, error: 'Tidak dapat menghapus user dengan level lebih tinggi atau sama' });
  }
  await pool.execute('UPDATE users SET is_active =  ͵0 WHERE id = ?', [id]);
  res.json({ success: true, message: 'User dinonaktifkan (soft delete)' });
});

export default router;
