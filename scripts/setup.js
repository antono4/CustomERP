/**
 * Setup & seed awal — jalankan SETELAH schema.sql diimport ke MySQL:
 *   1. mysql -u root -p < database/schema.sql
 *   2. node scripts/setup.js
 *
 * Script ini mengisi user default dengan bcrypt hash (password: password123\)
 * dan menetapkan role superadmin/admin/manager/user.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

const USERS = [
  { username: 'superadmin', fullName: 'Super Administrator', email: 'sa@nexus.local', roleLevel: 4 },
  { username: 'admin',      fullName: 'Administrator ERP',   email: 'admin@nexus.local',  roleLevel: 3 },
  { username: 'manager',    fullName: 'Operations Manager',  email: 'manager@nexus.local', roleLevel: 2 },
  { username: 'user',       fullName: 'Staff Operasional',      email: 'user@nexus.local',    roleLevel: 1 },
];

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);
  for (const u of USERS) {
    await pool.execute(
      `INSERT INTO users (username, password_hash, full_name, email, role_id)
       VALUES (?, ?, ?, ?, (
         SELECT id FROM roles WHERE level = ?
       ))
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         email = VALUES(email),
         password_hash = VALUES(password_hash),
         role_id = VALUES(role_id)`,
      [u.username, passwordHash, u.fullName, u.email ?? null, u.roleLevel],
    );
    console.log(`  seeded ${u.username} (level ${u.roleLevel})`);
  }
  console.log('\nSeed selesai. Password default semua user: password123');
  await pool.end();
}

main().catch((err) => {
  console.error('Setup gagal:', err);
  process.exit(1);
});