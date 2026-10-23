const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const clientesRepo = require('../repositories/clientesRepository');
const categoriasRepo = require('../repositories/categoriasDescuentoRepository');
const { CATEGORY_DEFAULT_DISCOUNTS } = require('../utils/pricingCalculator');
const logger = require('../config/logger');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || '7d';

function generateClientToken(cliente) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no configurado en servidor');
  }
  return jwt.sign(
    {
      id: cliente.id,
      email: cliente.email,
      nombre: cliente.nombre,
      role: 'cliente',
      categoria: cliente.categoria || 'minorista',
      descuento_porcentaje: parseFloat(cliente.descuento_porcentaje) || 0,
      empresa_razon_social: cliente.empresa_razon_social || null,
    },
    secret,
    { expiresIn: TOKEN_EXPIRES_IN, algorithm: 'HS256' }
  );
}

function setClientAuthCookie(res, token) {
  res.cookie('cotibot_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
    path: '/',
  });
}

function clearClientAuthCookie(res) {
  res.clearCookie('cotibot_token', { path: '/' });
}

const DUMMY_HASH = '$2a$10$wT8K4K0P.Pz3a0X9Zk/L8u5fX5zY9Pz4q8uW.Pz3a0X9Zk/L8u5fX';

module.exports = {
  async registro(req, res, next) {
    try {
      const {
        email,
        password,
        nombre,
        empresa_razon_social,
        rut_ci,
        telefono,
      } = req.body;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || typeof email !== 'string' || !emailRegex.test(email.trim()) || email.trim().length > 255) {
        return res.status(400).json({ error: 'Debe ingresar un correo electrónico válido' });
      }

      if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
        return res.status(400).json({ error: 'La contraseña debe tener entre 6 y 128 caracteres' });
      }

      if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.trim().length > 150) {
        return res.status(400).json({ error: 'El nombre o razón social es obligatorio (máximo 150 caracteres)' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const existing = await clientesRepo.findByEmail(cleanEmail);
      if (existing) {
        return res.status(409).json({ error: 'Ya existe una cuenta registrada con este correo electrónico' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      // Seguridad: todo autoregistro público inicia estrictamente como 'minorista' (0% de descuento).
      // Para ascender a 'gremio', 'empresa' o 'mayorista', debe ser verificado y aprobado por un administrador.
      const initialCategoria = 'minorista';
      const initialDiscount = 0;

      const cleanEmpresa = empresa_razon_social && typeof empresa_razon_social === 'string'
        ? empresa_razon_social.trim().slice(0, 200)
        : null;
      const cleanRutCi = rut_ci && typeof rut_ci === 'string'
        ? rut_ci.trim().slice(0, 50)
        : null;
      const cleanTelefono = telefono && typeof telefono === 'string'
        ? telefono.trim().slice(0, 50)
        : null;

      const nuevoCliente = await clientesRepo.create({
        email: cleanEmail,
        passwordHash,
        nombre: nombre.trim(),
        empresa_razon_social: cleanEmpresa,
        rut_ci: cleanRutCi,
        telefono: cleanTelefono,
        categoria: initialCategoria,
        descuento_porcentaje: initialDiscount,
      });

      const token = generateClientToken(nuevoCliente);
      setClientAuthCookie(res, token);

      logger.info('[ClienteAuth] Nuevo cliente registrado exitosamente', {
        id: nuevoCliente.id,
        email: nuevoCliente.email,
        categoria: nuevoCliente.categoria,
      });

      return res.status(201).json({
        success: true,
        message: 'Cuenta creada exitosamente',
        token,
        cliente: {
          id: nuevoCliente.id,
          email: nuevoCliente.email,
          nombre: nuevoCliente.nombre,
          empresa_razon_social: nuevoCliente.empresa_razon_social,
          categoria: nuevoCliente.categoria,
          descuento_porcentaje: parseFloat(nuevoCliente.descuento_porcentaje) || 0,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Debe proporcionar email y contraseña' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const cliente = await clientesRepo.findByEmail(cleanEmail);

      // Dummy comparison to prevent timing attacks when email does not exist
      const hashToCompare = (cliente && cliente.password_hash) ? cliente.password_hash : DUMMY_HASH;
      const passwordMatch = await bcrypt.compare(password, hashToCompare);

      if (!cliente || !passwordMatch) {
        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      }

      if (!cliente.activo) {
        return res.status(403).json({ error: 'Esta cuenta ha sido desactivada. Comuníquese con soporte.' });
      }

      const token = generateClientToken(cliente);
      setClientAuthCookie(res, token);

      logger.info('[ClienteAuth] Cliente inició sesión', {
        id: cliente.id,
        email: cliente.email,
        categoria: cliente.categoria,
      });

      return res.json({
        success: true,
        token,
        cliente: {
          id: cliente.id,
          email: cliente.email,
          nombre: cliente.nombre,
          empresa_razon_social: cliente.empresa_razon_social,
          categoria: cliente.categoria,
          descuento_porcentaje: parseFloat(cliente.descuento_porcentaje) || 0,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  me(req, res) {
    if (!req.cliente) {
      return res.json({
        success: true,
        authenticated: false,
        cliente: null,
      });
    }
    return res.json({
      success: true,
      authenticated: true,
      cliente: req.cliente,
    });
  },

  logout(req, res) {
    clearClientAuthCookie(res);
    return res.json({ success: true, message: 'Sesión cerrada correctamente' });
  },
};
