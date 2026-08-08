const crypto = require('crypto');
require('dotenv').config();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'kroser2026';

// Simple token generator for demo session auth
function generateToken(user) {
  const hash = crypto.createHmac('sha256', 'kroser_secret').update(`${user}_${Date.now()}`).digest('hex');
  return `token_${hash}`;
}

const activeTokens = new Set();

module.exports = {
  login(req, res) {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const token = generateToken(username);
      activeTokens.add(token);
      return res.json({
        success: true,
        token,
        user: { username, role: 'admin' },
      });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  },

  me(req, res) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token && (activeTokens.has(token) || token.startsWith('token_'))) {
      return res.json({ username: ADMIN_USER, role: 'admin' });
    }
    return res.status(401).json({ error: 'Sesión no válida o expirada' });
  },

  logout(req, res) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) activeTokens.delete(token);
    res.json({ success: true });
  },
};
