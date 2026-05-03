import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parseDocument } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'data');
const COOKIE_NAME = 'yaml_editor_session';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function readConfig(env = process.env) {
  return {
    port: Number.parseInt(env.PORT || '3000', 10),
    dataDir: path.resolve(env.DATA_DIR || DEFAULT_DATA_DIR),
    username: env.APP_USERNAME || 'admin',
    password: env.APP_PASSWORD || 'admin',
    sessionSecret: env.SESSION_SECRET || 'dev-secret-change-me',
    sessionTtlSeconds: Number.parseInt(env.SESSION_TTL_SECONDS || `${12 * 60 * 60}`, 10),
    cookieSecure: env.COOKIE_SECURE === 'true',
    maxFileBytes: Number.parseInt(env.MAX_FILE_BYTES || `${1024 * 1024}`, 10),
    maxListFiles: Number.parseInt(env.MAX_LIST_FILES || '1000', 10)
  };
}

export function isYamlFileName(filePath) {
  return /\.(ya?ml)$/i.test(filePath);
}

export function resolveYamlPath(requestedPath, config) {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new HttpError(400, 'Missing file path.');
  }

  const rawPath = requestedPath.replaceAll('\\', '/').trim();
  if (rawPath.includes('\0') || rawPath.startsWith('/')) {
    throw new HttpError(400, 'Invalid file path.');
  }

  const normalized = path.posix.normalize(rawPath);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new HttpError(400, 'Invalid file path.');
  }

  if (!isYamlFileName(normalized)) {
    throw new HttpError(400, 'Only .yaml and .yml files are allowed.');
  }

  const root = path.resolve(config.dataDir);
  const absolutePath = path.resolve(root, ...normalized.split('/'));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(400, 'File path escapes the data directory.');
  }

  return { absolutePath, relativePath: normalized };
}

export async function listYamlFiles(config) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const files = [];

  async function walk(currentDir) {
    if (files.length >= config.maxListFiles) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= config.maxListFiles) {
        return;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isYamlFileName(entry.name)) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      files.push({
        path: path.relative(config.dataDir, absolutePath).split(path.sep).join('/'),
        size: stats.size,
        mtimeMs: stats.mtimeMs
      });
    }
  }

  await walk(config.dataDir);
  return files;
}

function yamlIssueToResponse(issue, severity) {
  const position = issue.linePos?.[0] || {};
  return {
    severity,
    line: position.line || null,
    column: position.col || null,
    message: String(issue.message || 'YAML issue.')
      .split('\n')[0]
      .replace(/ at line \d+, column \d+:$/, '')
  };
}

export function lintYamlContent(content) {
  const source = typeof content === 'string' ? content : '';
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    strict: true,
    uniqueKeys: true
  });

  const messages = [
    ...document.errors.map((error) => yamlIssueToResponse(error, 'error')),
    ...document.warnings.map((warning) => yamlIssueToResponse(warning, 'warning'))
  ];

  source.split('\n').forEach((line, index) => {
    if (line.includes('\t')) {
      messages.push({
        severity: 'warning',
        line: index + 1,
        column: line.indexOf('\t') + 1,
        message: 'Tabs sind in YAML-Einrueckungen fehleranfaellig.'
      });
    }
    if (line.trimEnd() !== line) {
      messages.push({
        severity: 'warning',
        line: index + 1,
        column: line.trimEnd().length + 1,
        message: 'Leerzeichen am Zeilenende.'
      });
    }
  });

  return {
    valid: messages.every((message) => message.severity !== 'error'),
    messages
  };
}

function safeCompare(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  if (first.length !== second.length) {
    return false;
  }
  return crypto.timingSafeEqual(first, second);
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionCookie(username, config) {
  const expiresAt = Math.floor(Date.now() / 1000) + config.sessionTtlSeconds;
  const payload = base64UrlJson({ username, expiresAt });
  const signature = signPayload(payload, config.sessionSecret);
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionTtlSeconds}${secure}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const splitAt = part.indexOf('=');
        if (splitAt === -1) {
          return [part, ''];
        }
        return [part.slice(0, splitAt), decodeURIComponent(part.slice(splitAt + 1))];
      })
  );
}

function readSession(req, config) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token || !token.includes('.')) {
    return null;
  }

  const [payload, signature] = token.split('.');
  const expectedSignature = signPayload(payload, config.sessionSecret);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.username || Number(session.expiresAt) < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function readJsonBody(req, limitBytes) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function commonHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, commonHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  }));
  res.end(body);
}

function sendNoContent(res, headers = {}) {
  res.writeHead(204, commonHeaders({ 'Cache-Control': 'no-store', ...headers }));
  res.end();
}

function getUrl(req) {
  return new URL(req.url || '/', 'http://localhost');
}

async function handleApi(req, res, config) {
  const url = getUrl(req);

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readJsonBody(req, 16 * 1024);
    if (!safeCompare(body.username || '', config.username) || !safeCompare(body.password || '', config.password)) {
      throw new HttpError(401, 'Invalid username or password.');
    }
    sendJson(res, 200, { username: config.username }, {
      'Set-Cookie': createSessionCookie(config.username, config)
    });
    return;
  }

  const session = readSession(req, config);
  if (!session) {
    throw new HttpError(401, 'Login required.');
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    sendNoContent(res, { 'Set-Cookie': clearSessionCookie() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    sendJson(res, 200, { username: session.username, dataDir: config.dataDir });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/files') {
    const files = await listYamlFiles(config);
    sendJson(res, 200, { files, truncated: files.length >= config.maxListFiles });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/lint') {
    const body = await readJsonBody(req, config.maxFileBytes + 16 * 1024);
    const content = typeof body.content === 'string' ? body.content : '';
    if (Buffer.byteLength(content, 'utf8') > config.maxFileBytes) {
      throw new HttpError(413, 'File content is too large.');
    }
    sendJson(res, 200, lintYamlContent(content));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/file') {
    const { absolutePath, relativePath } = resolveYamlPath(url.searchParams.get('path'), config);
    const stats = await fs.stat(absolutePath).catch(() => {
      throw new HttpError(404, 'File was not found.');
    });
    if (!stats.isFile()) {
      throw new HttpError(400, 'Path is not a file.');
    }
    if (stats.size > config.maxFileBytes) {
      throw new HttpError(413, 'File is too large for this editor.');
    }
    const content = await fs.readFile(absolutePath, 'utf8');
    sendJson(res, 200, {
      path: relativePath,
      content,
      size: stats.size,
      mtimeMs: stats.mtimeMs
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/file') {
    const body = await readJsonBody(req, config.maxFileBytes + 16 * 1024);
    const content = typeof body.content === 'string' ? body.content : '';
    const size = Buffer.byteLength(content, 'utf8');
    if (size > config.maxFileBytes) {
      throw new HttpError(413, 'File content is too large.');
    }

    const { absolutePath, relativePath } = resolveYamlPath(body.path, config);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, absolutePath);
    const stats = await fs.stat(absolutePath);
    sendJson(res, 200, {
      path: relativePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs
    });
    return;
  }

  throw new HttpError(404, 'API route was not found.');
}

async function serveStatic(req, res) {
  const url = getUrl(req);
  const cleanPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const normalized = path.posix.normalize(cleanPath);
  if (!['GET', 'HEAD'].includes(req.method || '') || normalized.includes('..')) {
    throw new HttpError(404, 'Page was not found.');
  }

  const absolutePath = path.resolve(PUBLIC_DIR, `.${normalized}`);
  if (!absolutePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    throw new HttpError(404, 'Page was not found.');
  }

  const stats = await fs.stat(absolutePath).catch(() => {
    throw new HttpError(404, 'Page was not found.');
  });
  if (!stats.isFile()) {
    throw new HttpError(404, 'Page was not found.');
  }

  const contentType = MIME_TYPES.get(path.extname(absolutePath)) || 'application/octet-stream';
  res.writeHead(200, commonHeaders({
    'Content-Type': contentType,
    'Content-Length': stats.size,
    'Cache-Control': contentType.startsWith('text/html') ? 'no-store' : 'public, max-age=300'
  }));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(absolutePath).pipe(res);
}

async function handleRequest(req, res, config) {
  try {
    const url = getUrl(req);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, config);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    if (!res.headersSent) {
      sendJson(res, status, { error: message });
    } else {
      res.end();
    }
  }
}

export function createServer(overrides = {}) {
  const config = { ...readConfig(), ...overrides };
  return http.createServer((req, res) => {
    handleRequest(req, res, config);
  });
}

if (process.argv[1] === __filename) {
  const config = readConfig();
  const server = createServer(config);
  server.listen(config.port, () => {
    console.log(`YAML editor listening on http://localhost:${config.port}`);
    console.log(`Editing YAML files below ${config.dataDir}`);
  });
}
