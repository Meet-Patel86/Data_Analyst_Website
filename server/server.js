const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
const PUBLIC_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(__dirname, 'data');
const MAX_BODY_SIZE = 5_000_000;
const SESSION_DAYS = 30;
const DATASET_SAMPLE_LIMIT = Number(process.env.DATASET_SAMPLE_LIMIT || 10);
const DATASET_ANALYSIS_LIMIT = Number(process.env.DATASET_ANALYSIS_LIMIT || 500);

const storeFiles = {
  contacts: path.join(DATA_DIR, 'contacts.json'),
  datasets: path.join(DATA_DIR, 'datasets.json'),
  users: path.join(DATA_DIR, 'users.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  events: path.join(DATA_DIR, 'events.json')
};

const oauth = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo'
  },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID || '',
    teamId: process.env.APPLE_TEAM_ID || '',
    keyId: process.env.APPLE_KEY_ID || '',
    privateKey: (process.env.APPLE_PRIVATE_KEY || '').replace(/\n/g, '\n'),
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token'
  }
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

let mongoClient = null;
let mongoDb = null;
let storeMode = 'json';

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function getRequestPath(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
    const index = cookie.indexOf('=');
    const key = cookie.slice(0, index).trim();
    const value = decodeURIComponent(cookie.slice(index + 1));
    return [key, value];
  }));
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (BASE_URL.startsWith('https://')) parts.push('Secure');
  return parts.join('; ');
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function signedCookie(value) {
  return `${value}.${sign(value)}`;
}

function verifySignedCookie(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) return null;
  const [value, signature] = cookieValue.split('.');
  const expected = sign(value);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return value;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw new Error('Invalid JSON body'); }
}

async function initStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await Promise.all(Object.values(storeFiles).map(file => fsp.access(file).catch(() => fsp.writeFile(file, '[]', 'utf8'))));

  if (!process.env.MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb');
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGODB_DB || 'datastudio');
    storeMode = 'mongodb';
    await Promise.all([
      mongoDb.collection('users').createIndex({ provider: 1, providerId: 1 }, { unique: true }),
      mongoDb.collection('sessions').createIndex({ expiresAt: 1 }),
      mongoDb.collection('events').createIndex({ createdAt: -1 })
    ]);
  } catch (error) {
    console.warn('MongoDB is configured but unavailable. Falling back to JSON storage:', error.message);
    mongoClient = null;
    mongoDb = null;
    storeMode = 'json';
  }
}

async function readStore(name) {
  if (mongoDb) return mongoDb.collection(name).find({}).sort({ createdAt: -1 }).toArray();
  const text = await fsp.readFile(storeFiles[name], 'utf8');
  try {
    const data = JSON.parse(text || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeStore(name, rows) {
  if (mongoDb) {
    const collection = mongoDb.collection(name);
    await collection.deleteMany({});
    if (rows.length) await collection.insertMany(rows);
    return;
  }
  await fsp.writeFile(storeFiles[name], JSON.stringify(rows, null, 2), 'utf8');
}

async function insertStore(name, row, limit) {
  if (mongoDb) {
    await mongoDb.collection(name).insertOne(row);
    return row;
  }
  const rows = await readStore(name);
  rows.unshift(row);
  await writeStore(name, limit ? rows.slice(0, limit) : rows);
  return row;
}

function requestForm(url, form) {
  const body = querystring.stringify(form);
  const target = new URL(url);
  const options = {
    method: 'POST',
    hostname: target.hostname,
    path: `${target.pathname}${target.search}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(parsed.error_description || parsed.error || `OAuth request failed with ${response.statusCode}`));
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function requestJson(url, accessToken) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method: 'GET',
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: { Authorization: `Bearer ${accessToken}` }
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(parsed.error_description || parsed.error || `OAuth request failed with ${response.statusCode}`));
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function parseJwt(token) {
  const payload = token.split('.')[1];
  if (!payload) return {};
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

function makeAppleClientSecret() {
  if (!oauth.apple.teamId || !oauth.apple.keyId || !oauth.apple.clientId || !oauth.apple.privateKey) {
    throw new Error('Apple OAuth is not configured. Set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY.');
  }
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: oauth.apple.keyId })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: oauth.apple.teamId, iat: now, exp: now + 60 * 60 * 24 * 30, aud: 'https://appleid.apple.com', sub: oauth.apple.clientId })).toString('base64url');
  const data = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(data), oauth.apple.privateKey).toString('base64url');
  return `${data}.${signature}`;
}

async function isAdmin(user) {
  if (!user) return false;
  const email = String(user.email || '').toLowerCase();
  if (ADMIN_EMAILS.includes(email)) return true;
  if (ADMIN_EMAILS.length) return false;
  const users = await readStore('users');
  const firstUser = users.slice().sort((a, b) => new Date(a.firstSeenAt) - new Date(b.firstSeenAt))[0];
  return Boolean(firstUser && firstUser.id === user.id);
}

function publicUser(user) {
  if (!user) return null;
  const { providerId, ...safeUser } = user;
  return safeUser;
}

async function upsertUser(profile) {
  const users = await readStore('users');
  const now = new Date().toISOString();
  let user = users.find(item => item.provider === profile.provider && item.providerId === profile.providerId);

  if (!user) {
    user = {
      id: crypto.randomUUID(),
      provider: profile.provider,
      providerId: profile.providerId,
      email: profile.email || '',
      name: profile.name || '',
      picture: profile.picture || '',
      firstSeenAt: now,
      lastSeenAt: now,
      loginCount: 1,
      visitCount: 0
    };
    if (mongoDb) await mongoDb.collection('users').insertOne(user);
    else await writeStore('users', [user, ...users]);
  } else {
    user.email = profile.email || user.email;
    user.name = profile.name || user.name;
    user.picture = profile.picture || user.picture;
    user.lastSeenAt = now;
    user.loginCount = Number(user.loginCount || 0) + 1;
    if (mongoDb) await mongoDb.collection('users').updateOne({ id: user.id }, { $set: user });
    else await writeStore('users', users.map(item => item.id === user.id ? user : item));
  }

  await recordEvent(user.id, 'login', { provider: profile.provider });
  return user;
}

async function updateUser(user) {
  const users = await readStore('users');
  if (mongoDb) await mongoDb.collection('users').updateOne({ id: user.id }, { $set: user });
  else await writeStore('users', users.map(item => item.id === user.id ? user : item));
}

async function createSession(userId) {
  const now = Date.now();
  const session = { id: crypto.randomUUID(), userId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString() };
  if (mongoDb) await mongoDb.collection('sessions').insertOne(session);
  else {
    const sessions = await readStore('sessions');
    const activeSessions = sessions.filter(item => new Date(item.expiresAt).getTime() > now);
    await writeStore('sessions', [session, ...activeSessions]);
  }
  return session;
}

async function getCurrentUser(req) {
  const sessionId = verifySignedCookie(parseCookies(req).ds_session);
  if (!sessionId) return null;
  const now = Date.now();
  const sessions = await readStore('sessions');
  const session = sessions.find(item => item.id === sessionId && new Date(item.expiresAt).getTime() > now);
  if (!session) return null;
  const users = await readStore('users');
  return users.find(user => user.id === session.userId) || null;
}

async function clearSession(req, res) {
  const sessionId = verifySignedCookie(parseCookies(req).ds_session);
  if (sessionId) {
    if (mongoDb) await mongoDb.collection('sessions').deleteOne({ id: sessionId });
    else {
      const sessions = await readStore('sessions');
      await writeStore('sessions', sessions.filter(item => item.id !== sessionId));
    }
  }
  res.setHeader('Set-Cookie', cookieHeader('ds_session', '', { maxAge: 0 }));
}

async function completeLogin(res, user) {
  const session = await createSession(user.id);
  res.setHeader('Set-Cookie', cookieHeader('ds_session', signedCookie(session.id), { maxAge: SESSION_DAYS * 24 * 60 * 60 }));
  redirect(res, '/');
}

async function recordEvent(userId, type, details = {}) {
  const event = { id: crypto.randomUUID(), userId, type, details, createdAt: new Date().toISOString() };
  await insertStore('events', event, 500);
  return event;
}

async function recordVisit(user) {
  const now = new Date().toISOString();
  user.lastSeenAt = now;
  user.visitCount = Number(user.visitCount || 0) + 1;
  await updateUser(user);
  await recordEvent(user.id, 'app_visit');
}

function summarizeRows(rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const columnProfiles = columns.map(name => {
    const values = rows.map(row => row[name]);
    const filledValues = values.filter(value => value !== '' && value !== null && value !== undefined && value !== 'Unknown');
    const numericValues = filledValues.map(value => Number(value)).filter(value => Number.isFinite(value));
    const unique = new Set(filledValues.map(value => String(value))).size;
    const type = numericValues.length / Math.max(filledValues.length, 1) > 0.7 ? 'numeric' : 'text';
    const profile = { name, type, filled: filledValues.length, missing: rows.length - filledValues.length, unique };
    if (type === 'numeric' && numericValues.length) {
      const total = numericValues.reduce((sum, value) => sum + value, 0);
      profile.min = Math.min(...numericValues);
      profile.max = Math.max(...numericValues);
      profile.average = Number((total / numericValues.length).toFixed(2));
    }
    return profile;
  });
  return { rowCount: rows.length, columnCount: columns.length, columns, columnProfiles };
}

function usageStats(users, datasets, contacts, events) {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const since = days => new Date(now - days * dayMs).getTime();
  const after = (rows, field, days) => rows.filter(row => new Date(row[field] || row.createdAt).getTime() >= since(days)).length;
  const eventCounts = events.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {});
  return {
    totals: {
      users: users.length,
      datasets: datasets.length,
      contacts: contacts.length,
      events: events.length,
      logins: eventCounts.login || 0,
      appVisits: eventCounts.app_visit || 0
    },
    recent: {
      usersToday: after(users, 'firstSeenAt', 1),
      users7d: after(users, 'firstSeenAt', 7),
      datasetsToday: after(datasets, 'createdAt', 1),
      datasets7d: after(datasets, 'createdAt', 7),
      contacts7d: after(contacts, 'createdAt', 7)
    },
    activeUsers: users.slice().sort((a, b) => Number(b.loginCount || 0) - Number(a.loginCount || 0)).slice(0, 8).map(publicUser),
    latestUsers: users.slice().sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt)).slice(0, 8).map(publicUser),
    latestDatasets: datasets.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    latestContacts: contacts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    storeMode
  };
}

async function requireAdmin(req, res) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    sendJson(res, 401, { error: 'Login required.' });
    return null;
  }
  if (!(await isAdmin(currentUser))) {
    sendJson(res, 403, { error: 'Admin access required.' });
    return null;
  }
  return currentUser;
}

async function handleAuth(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestPath = requestUrl.pathname;

  if (req.method === 'GET' && requestPath === '/auth/google') {
    if (!oauth.google.clientId || !oauth.google.clientSecret) return redirect(res, '/login?error=google_not_configured');
    const state = crypto.randomUUID();
    res.setHeader('Set-Cookie', cookieHeader('oauth_state', signedCookie(state), { maxAge: 10 * 60 }));
    const params = new URLSearchParams({ client_id: oauth.google.clientId, redirect_uri: `${BASE_URL}/auth/google/callback`, response_type: 'code', scope: 'openid email profile', prompt: 'select_account', state });
    return redirect(res, `${oauth.google.authUrl}?${params}`);
  }

  if (req.method === 'GET' && requestPath === '/auth/google/callback') {
    try {
      const state = verifySignedCookie(parseCookies(req).oauth_state);
      if (!state || state !== requestUrl.searchParams.get('state')) throw new Error('Invalid OAuth state.');
      const code = requestUrl.searchParams.get('code');
      if (!code) throw new Error('Missing Google authorization code.');
      const token = await requestForm(oauth.google.tokenUrl, { code, client_id: oauth.google.clientId, client_secret: oauth.google.clientSecret, redirect_uri: `${BASE_URL}/auth/google/callback`, grant_type: 'authorization_code' });
      const profile = await requestJson(oauth.google.userInfoUrl, token.access_token);
      const user = await upsertUser({ provider: 'google', providerId: profile.sub, email: profile.email, name: profile.name, picture: profile.picture });
      res.setHeader('Set-Cookie', cookieHeader('oauth_state', '', { maxAge: 0 }));
      return completeLogin(res, user);
    } catch (error) {
      return redirect(res, `/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  if (req.method === 'GET' && requestPath === '/auth/apple') {
    if (!oauth.apple.clientId) return redirect(res, '/login?error=apple_not_configured');
    const state = crypto.randomUUID();
    res.setHeader('Set-Cookie', cookieHeader('oauth_state', signedCookie(state), { maxAge: 10 * 60 }));
    const params = new URLSearchParams({ client_id: oauth.apple.clientId, redirect_uri: `${BASE_URL}/auth/apple/callback`, response_type: 'code id_token', response_mode: 'form_post', scope: 'name email', state });
    return redirect(res, `${oauth.apple.authUrl}?${params}`);
  }

  if (req.method === 'POST' && requestPath === '/auth/apple/callback') {
    try {
      const body = querystring.parse(await readBody(req));
      const state = verifySignedCookie(parseCookies(req).oauth_state);
      if (!state || state !== body.state) throw new Error('Invalid OAuth state.');
      if (!body.code) throw new Error('Missing Apple authorization code.');
      const token = await requestForm(oauth.apple.tokenUrl, { code: body.code, client_id: oauth.apple.clientId, client_secret: makeAppleClientSecret(), redirect_uri: `${BASE_URL}/auth/apple/callback`, grant_type: 'authorization_code' });
      const claims = parseJwt(token.id_token || body.id_token || '');
      const postedUser = body.user ? JSON.parse(body.user) : {};
      const user = await upsertUser({ provider: 'apple', providerId: claims.sub, email: claims.email || '', name: postedUser.name ? [postedUser.name.firstName, postedUser.name.lastName].filter(Boolean).join(' ') : '' });
      res.setHeader('Set-Cookie', cookieHeader('oauth_state', '', { maxAge: 0 }));
      return completeLogin(res, user);
    } catch (error) {
      return redirect(res, `/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  if (req.method === 'POST' && requestPath === '/auth/logout') {
    await clearSession(req, res);
    return redirect(res, '/login');
  }

  return sendJson(res, 404, { error: 'Auth route not found.' });
}

async function handleApi(req, res) {
  const requestPath = getRequestPath(req);
  if (req.method === 'GET' && requestPath === '/api/health') return sendJson(res, 200, { ok: true, app: 'DataStudio', storeMode, time: new Date().toISOString() });
  if (req.method === 'GET' && requestPath === '/api/auth/config') {
    const users = await readStore('users');
    return sendJson(res, 200, { ok: true, totalUsers: users.length, googleConfigured: Boolean(oauth.google.clientId && oauth.google.clientSecret), appleConfigured: Boolean(oauth.apple.clientId && oauth.apple.teamId && oauth.apple.keyId && oauth.apple.privateKey), storeMode });
  }

  const currentUser = await getCurrentUser(req);
  if (!currentUser) return sendJson(res, 401, { error: 'Login required.' });

  if (req.method === 'GET' && requestPath === '/api/me') return sendJson(res, 200, { ok: true, user: publicUser(currentUser), isAdmin: await isAdmin(currentUser) });

  if (req.method === 'GET' && requestPath === '/api/admin/stats') {
    if (!(await requireAdmin(req, res))) return;
    const [users, datasets, contacts, events] = await Promise.all([readStore('users'), readStore('datasets'), readStore('contacts'), readStore('events')]);
    return sendJson(res, 200, { ok: true, ...usageStats(users, datasets, contacts, events) });
  }

  if (req.method === 'GET' && requestPath === '/api/admin/export') {
    if (!(await requireAdmin(req, res))) return;
    const [users, datasets, contacts, events] = await Promise.all([readStore('users'), readStore('datasets'), readStore('contacts'), readStore('events')]);
    return sendJson(res, 200, { ok: true, exportedAt: new Date().toISOString(), users: users.map(publicUser), datasets, contacts, events, storeMode });
  }

  if (req.method === 'GET' && requestPath === '/api/users') {
    if (!(await requireAdmin(req, res))) return;
    const users = await readStore('users');
    return sendJson(res, 200, { ok: true, totalUsers: users.length, users: users.map(publicUser) });
  }

  if (req.method === 'GET' && requestPath === '/api/contacts') {
    if (!(await requireAdmin(req, res))) return;
    return sendJson(res, 200, { ok: true, contacts: await readStore('contacts') });
  }

  if (req.method === 'POST' && requestPath === '/api/contact') {
    try {
      const payload = await readJson(req);
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim();
      const message = String(payload.message || '').trim();
      if (!name || !email) return sendJson(res, 400, { error: 'Name and email are required.' });
      const contact = { id: crypto.randomUUID(), userId: currentUser.id, name, email, message, source: payload.source || 'website', createdAt: new Date().toISOString() };
      await insertStore('contacts', contact);
      await recordEvent(currentUser.id, 'contact_submit', { contactId: contact.id });
      return sendJson(res, 201, { ok: true, message: 'Contact request saved.', contact });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'GET' && requestPath === '/api/datasets') {
    const admin = await isAdmin(currentUser);
    const datasets = (await readStore('datasets')).filter(dataset => admin || dataset.userId === currentUser.id);
    return sendJson(res, 200, { ok: true, datasets });
  }

  if (req.method === 'POST' && requestPath === '/api/datasets/analyze') {
    try {
      const payload = await readJson(req);
      const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, DATASET_ANALYSIS_LIMIT) : [];
      const summary = summarizeRows(rows);
      const dataset = { id: crypto.randomUUID(), userId: currentUser.id, fileName: payload.fileName || 'Untitled dataset', originalRows: Number(payload.originalRows || rows.length), cleanedRows: Number(payload.cleanedRows || rows.length), analyzedRows: rows.length, cleaningOptions: payload.cleaningOptions || {}, summary, sampleRows: rows.slice(0, DATASET_SAMPLE_LIMIT), createdAt: new Date().toISOString() };
      await insertStore('datasets', dataset, 100);
      await recordEvent(currentUser.id, 'dataset_analyzed', { datasetId: dataset.id, fileName: dataset.fileName, cleanedRows: dataset.cleanedRows });
      return sendJson(res, 201, { ok: true, dataset });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: 'API route not found.' });
}

async function serveStatic(req, res) {
  const requestPath = getRequestPath(req);
  const currentUser = await getCurrentUser(req);

  if ((requestPath === '/' || requestPath === '/index.html' || requestPath === '/admin') && !currentUser) return redirect(res, '/login');
  if (requestPath === '/admin' && !(await isAdmin(currentUser))) return redirect(res, '/');
  if (requestPath === '/login' && currentUser) return redirect(res, '/');
  if ((requestPath === '/' || requestPath === '/index.html') && currentUser) await recordVisit(currentUser);

  const routePath = requestPath === '/login' ? '/login.html' : requestPath === '/admin' ? '/admin.html' : requestPath;
  const normalizedPath = routePath === '/' ? 'index.html' : path.normalize(routePath).replace(/^([.][.][\\/])+/, '').replace(/^[\\/]+/, '');
  const filePath = path.join(PUBLIC_DIR, normalizedPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestPath = getRequestPath(req);
  if (requestPath.startsWith('/auth/')) return handleAuth(req, res);
  if (requestPath.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
});

initStore()
  .then(() => {
    server.listen(PORT, () => console.log(`DataStudio running at ${BASE_URL} using ${storeMode} storage`));
  })
  .catch(error => {
    console.error('Could not initialize backend store:', error);
    process.exit(1);
  });



