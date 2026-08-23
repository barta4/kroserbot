const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const REQUIRED_ENV = ['ADMIN_USER', 'ADMIN_PASSWORD', 'DEPOSITO_USER', 'DEPOSITO_PASSWORD', 'JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || String(process.env[key]).trim() === '') {
    console.error(`[FATAL] Falta variable de entorno requerida: ${key}`);
    throw new Error(`[FATAL] Falta variable de entorno requerida: ${key}`);
  }
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET debe tener al menos 32 caracteres');
  throw new Error('[FATAL] JWT_SECRET debe tener al menos 32 caracteres');
}

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
const DEPOSITO_USER = process.env.DEPOSITO_USER;
const DEPOSITO_PASS = process.env.DEPOSITO_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || '1h';

const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
const depositoHash = bcrypt.hashSync(DEPOSITO_PASS, 10);

const USERS = {
  [ADMIN_USER]: { passwordHash: adminHash, role: 'admin' },
  [DEPOSITO_USER]: { passwordHash: depositoHash, role: 'deposito' },
};

function generateToken(username, role) {
  return jwt.sign({ username, role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

function setAuthCookie(res, token) {
  res.cookie('kroser_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie('kroser_token', { path: '/' });
}

module.exports = {
  login(req, res) {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'username y password deben ser strings' });
    }
    if (password.length < 6 || password.length > 200) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = USERS[username];
    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const token = generateToken(username, user.role);
    setAuthCookie(res, token);

    return res.json({
      success: true,
      token,
      user: { username, role: user.role },
    });
  },

  me(req, res) {
    if (!req.user) {
      return res.status(401).json({ error: 'Sesión no válida o expirada' });
    }
    return res.json({ username: req.user.username, role: req.user.role });
  },

  logout(req, res) {
    clearAuthCookie(res);
    res.json({ success: true });
  },

  USERS,
};
