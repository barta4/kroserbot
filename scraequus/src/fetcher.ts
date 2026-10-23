const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface FetchOptions {
  timeoutMs?: number;
  skipAuth?: boolean;
}

let sessionCookies: string = '';
let sessionLoggedIn: boolean = false;
let sessionUser: string | null = null;

// Configuración de respeto estricto a robots.txt (Crawl-delay: 30)
const CRAWL_DELAY_SECONDS = parseInt(process.env.EQUUS_CRAWL_DELAY_SECONDS || '30', 10);
let lastRequestTime = 0;
let requestQueue: Promise<any> = Promise.resolve();

// Cargar variables de entorno si no estaban cargadas
try {
  process.loadEnvFile?.();
} catch {}

export function getSessionStatus() {
  return {
    isLoggedIn: sessionLoggedIn,
    user: sessionUser,
    crawlDelaySeconds: CRAWL_DELAY_SECONDS,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aplica la pausa de cortesía estipulada en robots.txt (Crawl-delay: 30).
 * Agrega un jitter aleatorio de 500ms a 2000ms para evitar patrones mecánicos.
 */
async function throttleRequest(): Promise<void> {
  const now = Date.now();
  const delayMs = CRAWL_DELAY_SECONDS * 1000;
  const elapsed = now - lastRequestTime;

  if (lastRequestTime > 0 && elapsed < delayMs) {
    const jitter = Math.floor(Math.random() * 1500) + 500;
    const waitTime = (delayMs - elapsed) + jitter;
    console.log(`⏱️ [Robots.txt Shield] Esperando ${(waitTime / 1000).toFixed(1)}s para cumplir Crawl-delay (${CRAWL_DELAY_SECONDS}s) y evitar bloqueos...`);
    await sleep(waitTime);
  }
  lastRequestTime = Date.now();
}

export async function loginEquus(force: boolean = false): Promise<boolean> {
  const user = process.env.EQUUS_USER;
  const pass = process.env.EQUUS_PASSWORD;

  if (!user || !pass) {
    return false;
  }

  if (sessionLoggedIn && !force && sessionCookies) {
    return true;
  }

  try {
    // 1. Obtener cookies de sesión iniciales
    const initRes = await fetch('https://www.equus.uy/', {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const initCookies = (initRes.headers.getSetCookie?.() || [initRes.headers.get('set-cookie') || ''])
      .map((c) => c.split(';')[0])
      .filter(Boolean);

    const cookieMap = new Map<string, string>();
    initCookies.forEach((c) => {
      const [k, v] = c.split('=');
      if (k && v) cookieMap.set(k.trim(), v.trim());
    });

    const getCookieHeader = () =>
      Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    // 2. Enviar credenciales mayoristas
    const params = new URLSearchParams();
    params.append('usuario', user);
    params.append('clave', pass);
    params.append('recordardatos', '1');
    params.append('dir_return', '/');

    const loginRes = await fetch('https://www.equus.uy/usuarios/scripts/validar_login.php', {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': getCookieHeader(),
        'Referer': 'https://www.equus.uy/'
      },
      body: params.toString()
    });

    const loginCookies = (loginRes.headers.getSetCookie?.() || [loginRes.headers.get('set-cookie') || ''])
      .map((c) => c.split(';')[0])
      .filter(Boolean);

    loginCookies.forEach((c) => {
      const [k, v] = c.split('=');
      if (k && v) cookieMap.set(k.trim(), v.trim());
    });

    sessionCookies = getCookieHeader();
    sessionLoggedIn = true;
    sessionUser = user;
    console.log(`🔐 Sesión mayorista (B2B) iniciada en Equus.uy con usuario: ${user}`);
    return true;
  } catch (err) {
    console.error('Error al iniciar sesión en Equus.uy:', err);
    sessionLoggedIn = false;
    sessionCookies = '';
    return false;
  }
}

async function executeSingleFetch(url: string, options: FetchOptions = {}, retryCount: number = 0): Promise<string> {
  const { timeoutMs = 25000, skipAuth = false } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Intentar login automático si hay credenciales configuradas
  if (!skipAuth && !sessionLoggedIn && process.env.EQUUS_USER && process.env.EQUUS_PASSWORD) {
    await loginEquus();
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8'
    };

    if (!skipAuth && sessionCookies) {
      headers['Cookie'] = sessionCookies;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers
    });

    // Manejo de Rate Limit (429) o Servicio Temporalmente no disponible (503)
    if ((response.status === 429 || response.status === 503) && retryCount < 2) {
      console.warn(`⚠️ HTTP ${response.status} detectado en Equus.uy. Activando enfriamiento de 60 segundos antes de reintentar...`);
      await sleep(60000);
      return executeSingleFetch(url, options, retryCount + 1);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} al consultar ${url}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Detectar codificación desde cabeceras HTTP o meta tags
    let encoding = 'utf-8';
    if (contentType.toLowerCase().includes('windows-1252')) {
      encoding = 'windows-1252';
    } else if (contentType.toLowerCase().includes('iso-8859-1')) {
      encoding = 'iso-8859-1';
    } else {
      const snippet = buffer.subarray(0, 1024).toString('ascii').toLowerCase();
      if (snippet.includes('charset=windows-1252') || snippet.includes('charset="windows-1252"')) {
        encoding = 'windows-1252';
      }
    }

    const decoder = new TextDecoder(encoding);
    return decoder.decode(buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Realiza peticiones serializadas y respetuosas a Equus.uy.
 * Todas las llamadas son encoladas secuencialmente respetando Crawl-delay.
 */
export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    requestQueue = requestQueue.then(async () => {
      try {
        await throttleRequest();
        const html = await executeSingleFetch(url, options);
        resolve(html);
      } catch (err) {
        reject(err);
      }
    });
  });
}
