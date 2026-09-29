# 📝 Tareas de Seguridad y Mantenimiento para la Noche — Servidor Kroserbot

Este documento reúne los puntos exactos a revisar y corregir en el servidor local de casa y en Dokploy esta noche.

---

## 🔒 1. Cerrar Exposición Pública del Puerto 3000 (Crítico)

- **Problema actual**: El puerto 3000 está reenviado en el router de casa y expone la pantalla de login del panel de **Dokploy** directamente a Internet (`http://venta.urufile.duckdns.org:3000`).
- **Qué hacer en el Router de Casa**:
  1. Ingresar a la administración del router (por ejemplo `http://192.168.1.1` o `192.168.0.1`).
  2. Ir a la sección de **Port Forwarding / Reenvío de Puertos / Servidores Virtuales**.
  3. **Eliminar o pausar la regla del puerto 3000**.
  4. Dejar abiertos y dirigidos al servidor únicamente los puertos:
     - **Puerto 80 (HTTP)** ➔ Traefik
     - **Puerto 443 (HTTPS)** ➔ Traefik
- **Cómo accederás a Dokploy después de cerrarlo**:
  - Desde cualquier dispositivo conectado al Wi-Fi o red de tu casa ingresando a la IP local:  
    `http://192.168.1.X:3000` (reemplazando `X` por la IP fija de tu servidor).
  - O mediante una VPN privada segura (Tailscale / WireGuard).

---

## ⚡ 2. Corregir Conexión de Redis en Dokploy (`memory_fallback` ➔ `up`)

- **Problema actual**: El endpoint `/api/health` responde `"services":{"database":"up","redis":"memory_fallback"}`. El bot funciona gracias al fallback en memoria, pero el contenedor backend no está comunicándose con el contenedor de Redis.
- **Qué hacer en Dokploy**:
  1. Abrir el proyecto en Dokploy.
  2. En las **Environment Variables (Variables de Entorno)** de la aplicación, asegurar que esté configurado:
     ```env
     REDIS_URL=redis://redis:6379
     REDIS_HOST=redis
     REDIS_PORT=6379
     ```
  3. Comprobar que en el `docker-compose.dokploy.yml` tanto el servicio `backend` como el servicio `redis` estén en la red interna:
     ```yaml
     networks:
       - kroserbot-network
     ```
  4. Reiniciar/redesplegar el stack para verificar en `/api/health` que aparezca:
     ```json
     {"status":"ok","services":{"database":"up","redis":"up"}}
     ```

---

## 🚀 3. Desplegar la Versión Actualizada v1.9.7

- **Problema actual**: En el servidor de casa aún corre la imagen compilada anterior (v1.9.6).
- **Qué hacer en Dokploy**:
  1. En la configuración del servicio backend en Dokploy, verificar que la imagen sea:
     ```
     alfredobartaburu/kroserbot:v1.9.7
     ```
  2. Pulsar el botón **Deploy / Redeploy**.
  3. Dokploy descargará automáticamente la imagen fresca que ya dejamos subida en Docker Hub con todas las mejoras de seguridad activas (sanitización de healthcheck, login con `await bcrypt.compare` y soporte transparente de cookies `HttpOnly`).

---

*Fecha de registro: 29 de Septiembre de 2026.*
