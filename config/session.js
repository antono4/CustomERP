import session from 'express-session';
import dotenv from 'dotenv';

dotenv.config();

/** Session store configuration (production: gunakan connect-redis / MySQL store\) */
const sessionConfig = {
  secret: process.env.SESSION_SECRET ?? 'nexus-erp-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8 jam
  },
  name: 'nexus.sid',
};

export default sessionConfig;