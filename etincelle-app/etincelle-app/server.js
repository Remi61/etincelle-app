const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'etincelle_secret_key_change_in_production';
const SEED_DEMO = process.env.SEED_DEMO !== 'false';
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const isPg = Boolean(DATABASE_URL);

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Route de santé pour Render
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// Upload en mémoire (converti en Data URL compressée pour persister dans la base cloud)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont autorisées.'));
  }
});

// ==================== COUCHE BASE DE DONNÉES UNIFIÉE (POSTGRESQL CLOUD / SQLITE) ====================

let pgPool = null;
let sqliteDb = null;

if (isPg) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  console.log('Mode base de données : PostgreSQL Cloud (Permanent)');
} else {
  const sqlite3 = require('sqlite3').verbose();
  sqliteDb = new sqlite3.Database(path.join(dataDir, 'etincelle.db'));
  console.log('Mode base de données : SQLite local (Ajoute DATABASE_URL pour le cloud permanent)');
}

function toPgSql(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

async function dbRun(sql, params = []) {
  if (isPg) {
    let pgSql = toPgSql(sql).trim();
    const isInsert = /^INSERT\s+INTO/i.test(pgSql);
    if (isInsert && !/RETURNING\s+/i.test(pgSql) && !/DO\s+NOTHING/i.test(pgSql)) {
      pgSql += ' RETURNING id';
    }
    const res = await pgPool.query(pgSql, params);
    return {
      lastID: res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null,
      changes: res.rowCount || 0
    };
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function dbGet(sql, params = []) {
  if (isPg) {
    const res = await pgPool.query(toPgSql(sql), params);
    return res.rows[0] || null;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

async function dbAll(sql, params = []) {
  if (isPg) {
    const res = await pgPool.query(toPgSql(sql), params);
    return res.rows || [];
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function initDb() {
  const idType = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const timeType = isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';

  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id ${idType},
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL DEFAULT 'autre',
      interested_in TEXT NOT NULL DEFAULT 'tous',
      city TEXT DEFAULT '',
      job TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      interests TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      created_at ${timeType}
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS swipes (
      id ${idType},
      swiper_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      icebreaker TEXT DEFAULT '',
      icebreaker_target TEXT DEFAULT '',
      created_at ${timeType},
      UNIQUE(swiper_id, target_id)
    )
  `);

  // Migration douce si la table swipes existait déjà sans colonnes brise-glace
  try {
    await dbRun(`ALTER TABLE swipes ADD COLUMN icebreaker TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    await dbRun(`ALTER TABLE swipes ADD COLUMN icebreaker_target TEXT DEFAULT ''`);
  } catch (_) {}

  await dbRun(`
    CREATE TABLE IF NOT EXISTS matches (
      id ${idType},
      user1_id INTEGER NOT NULL,
      user2_id INTEGER NOT NULL,
      created_at ${timeType},
      UNIQUE(user1_id, user2_id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS messages (
      id ${idType},
      match_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at ${timeType}
    )
  `);

  if (SEED_DEMO) {
    const countRow = await dbGet('SELECT COUNT(*) as total FROM users');
    const total = countRow ? Number(countRow.total) : 0;
    if (total === 0) {
      const demoPass = await bcrypt.hash('demo1234', 10);
      const demoUsers = [
        {
          email: 'camille@demo.fr',
          name: 'Camille',
          age: 26,
          gender: 'femme',
          interested_in: 'tous',
          city: 'Paris',
          job: 'Architecte d’intérieur',
          bio: 'Amoureuse de cafés en terrasse, de brocantes le dimanche et de randonnées spontanées.',
          interests: 'Architecture, Voyages, Café, Cinéma',
          photo_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80'
        },
        {
          email: 'lucas@demo.fr',
          name: 'Lucas',
          age: 28,
          gender: 'homme',
          interested_in: 'tous',
          city: 'Lyon',
          job: 'Développeur & Photographe',
          bio: 'Toujours partant pour découvrir une nouvelle adresse resto ou partir un week-end à la montagne.',
          interests: 'Photo, Cuisine, Escalade, Musique',
          photo_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80'
        },
        {
          email: 'chloe@demo.fr',
          name: 'Chloé',
          age: 25,
          gender: 'femme',
          interested_in: 'tous',
          city: 'Bordeaux',
          job: 'Graphiste freelance',
          bio: 'Team océan, concerts indie et soirées jeux de société entre amis.',
          interests: 'Design, Surf, Concerts, Lecture',
          photo_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80'
        },
        {
          email: 'thomas@demo.fr',
          name: 'Thomas',
          age: 30,
          gender: 'homme',
          interested_in: 'tous',
          city: 'Nantes',
          job: 'Chef pâtissier',
          bio: 'Je fais les meilleurs croissants du quartier. À toi de juger !',
          interests: 'Pâtisserie, Running, Cinéma, Voyages',
          photo_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80'
        }
      ];

      for (const u of demoUsers) {
        await dbRun(
          `INSERT INTO users (email, password_hash, name, age, gender, interested_in, city, job, bio, interests, photo_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.email, demoPass, u.name, u.age, u.gender, u.interested_in, u.city, u.job, u.bio, u.interests, u.photo_url]
        );
      }
      console.log('4 profils de test créés (mot de passe: demo1234)');
    }
  }
}

// ==================== PRÉSENCE TEMPS RÉEL (EN LIGNE) ====================

const onlineSockets = new Map(); // userId -> Set<socketId>

function isUserOnline(userId) {
  const set = onlineSockets.get(Number(userId));
  return Boolean(set && set.size > 0);
}

function getOnlineUserIds() {
  return Array.from(onlineSockets.keys());
}

// Middleware JWT
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = Number(payload.userId);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expirée ou invalide.' });
  }
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return { ...safe, online: isUserOnline(u.id) };
}

function resolvePhotoUrl(req, fallbackUrl) {
  if (req.body && req.body.photo_data && req.body.photo_data.startsWith('data:image/')) {
    return req.body.photo_data;
  }
  if (req.file && req.file.buffer) {
    const b64 = req.file.buffer.toString('base64');
    return `data:${req.file.mimetype};base64,${b64}`;
  }
  return fallbackUrl;
}

// ==================== ROUTES API ====================

// Inscription
app.post('/api/auth/register', upload.single('photo'), async (req, res) => {
  try {
    const { email, password, name, age, gender, interested_in, city, job, bio, interests } = req.body;
    if (!email || !password || !name || !age) {
      return res.status(400).json({ error: 'Email, mot de passe, prénom et âge sont obligatoires.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const parsedAge = parseInt(age, 10);
    if (isNaN(parsedAge) || parsedAge < 18 || parsedAge > 99) {
      return res.status(400).json({ error: 'Vous devez avoir au moins 18 ans.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const defaultAvatar = `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(name.trim())}&backgroundColor=ffd5dc`;
    const photoUrl = resolvePhotoUrl(req, defaultAvatar);

    const result = await dbRun(
      `INSERT INTO users (email, password_hash, name, age, gender, interested_in, city, job, bio, interests, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanEmail,
        passwordHash,
        name.trim(),
        parsedAge,
        gender || 'autre',
        interested_in || 'tous',
        (city || '').trim(),
        (job || '').trim(),
        (bio || '').trim(),
        (interests || '').trim(),
        photoUrl
      ]
    );

    const user = result.lastID
      ? await dbGet('SELECT * FROM users WHERE id = ?', [result.lastID])
      : await dbGet('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur inscription:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la création du compte.' });
  }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur login:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

// Profil connecté
app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ user: sanitizeUser(user) });
});

// Mise à jour du profil
app.put('/api/me', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const current = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!current) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const name = (req.body.name || current.name).trim();
    const age = req.body.age ? parseInt(req.body.age, 10) : current.age;
    const gender = req.body.gender || current.gender;
    const interested_in = req.body.interested_in || current.interested_in;
    const city = req.body.city !== undefined ? req.body.city.trim() : current.city;
    const job = req.body.job !== undefined ? req.body.job.trim() : current.job;
    const bio = req.body.bio !== undefined ? req.body.bio.trim() : current.bio;
    const interests = req.body.interests !== undefined ? req.body.interests.trim() : current.interests;
    const photoUrl = resolvePhotoUrl(req, current.photo_url);

    await dbRun(
      `UPDATE users SET name=?, age=?, gender=?, interested_in=?, city=?, job=?, bio=?, interests=?, photo_url=? WHERE id=?`,
      [name, age, gender, interested_in, city, job, bio, interests, photoUrl, req.userId]
    );

    const updated = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error('Erreur update profil:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour le profil.' });
  }
});

// Profils à découvrir (inclut le statut En ligne + éventuel brise-glace reçu de ce profil)
app.get('/api/discover', authMiddleware, async (req, res) => {
  try {
    const me = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!me) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    let query = `
      SELECT
        u.id, u.name, u.age, u.gender, u.city, u.job, u.bio, u.interests, u.photo_url,
        s.direction as incoming_direction,
        s.icebreaker as incoming_icebreaker,
        s.icebreaker_target as incoming_icebreaker_target
      FROM users u
      LEFT JOIN swipes s ON s.swiper_id = u.id AND s.target_id = ? AND s.direction IN ('like', 'superlike')
      WHERE u.id != ?
        AND u.id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = ?)
    `;
    const params = [req.userId, req.userId, req.userId];

    if (me.interested_in === 'homme' || me.interested_in === 'femme') {
      query += ` AND u.gender = ?`;
      params.push(me.interested_in);
    }

    // Prioriser en tête de pile les personnes qui nous ont envoyé un brise-glace ou un like
    query += ` ORDER BY (CASE WHEN s.id IS NOT NULL THEN 0 ELSE 1 END), u.id DESC LIMIT 50`;
    const rows = await dbAll(query, params);
    const profiles = rows.map((p) => ({
      ...p,
      online: isUserOnline(p.id)
    }));
    res.json({ profiles });
  } catch (err) {
    console.error('Erreur discover:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des profils.' });
  }
});

// Liste des likes / brise-glaces reçus en attente
app.get('/api/likes-received', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        u.id, u.name, u.age, u.city, u.job, u.bio, u.interests, u.photo_url,
        s.direction,
        s.icebreaker,
        s.icebreaker_target,
        s.created_at as liked_at
      FROM swipes s
      JOIN users u ON u.id = s.swiper_id
      WHERE s.target_id = ?
        AND s.direction IN ('like', 'superlike')
        AND s.swiper_id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = ?)
      ORDER BY s.id DESC
      `,
      [req.userId, req.userId]
    );
    res.json({
      likes: rows.map((r) => ({ ...r, online: isUserOnline(r.id) }))
    });
  } catch (err) {
    console.error('Erreur likes-received:', err);
    res.status(500).json({ error: 'Impossible de charger les likes reçus.' });
  }
});

// Enregistrer un swipe (like, superlike, pass) + Brise-glace optionnel
app.post('/api/swipe', authMiddleware, async (req, res) => {
  try {
    const { targetId, direction, icebreaker, icebreakerTarget } = req.body;
    const target = parseInt(targetId, 10);
    if (!target || !['like', 'superlike', 'pass'].includes(direction)) {
      return res.status(400).json({ error: 'Paramètres de swipe invalides.' });
    }
    if (target === req.userId) {
      return res.status(400).json({ error: 'Action impossible sur soi-même.' });
    }

    const cleanIcebreaker = direction === 'pass' ? '' : (icebreaker || '').trim().slice(0, 280);
    const cleanTarget = direction === 'pass' ? '' : (icebreakerTarget || '').trim().slice(0, 30);

    await dbRun(
      `INSERT INTO swipes (swiper_id, target_id, direction, icebreaker, icebreaker_target)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(swiper_id, target_id) DO UPDATE SET
         direction = EXCLUDED.direction,
         icebreaker = CASE WHEN EXCLUDED.icebreaker != '' THEN EXCLUDED.icebreaker ELSE swipes.icebreaker END,
         icebreaker_target = CASE WHEN EXCLUDED.icebreaker_target != '' THEN EXCLUDED.icebreaker_target ELSE swipes.icebreaker_target END`,
      [req.userId, target, direction, cleanIcebreaker, cleanTarget]
    );

    if (direction === 'pass') {
      return res.json({ matched: false });
    }

    const me = await dbGet(
      `SELECT id, name, age, city, job, bio, interests, photo_url FROM users WHERE id = ?`,
      [req.userId]
    );
    const partner = await dbGet(
      `SELECT id, name, age, city, job, bio, interests, photo_url FROM users WHERE id = ?`,
      [target]
    );

    // Vérifier si l'autre utilisateur a déjà liké ou superliké
    const reciprocal = await dbGet(
      `SELECT id, icebreaker, icebreaker_target FROM swipes WHERE swiper_id = ? AND target_id = ? AND direction IN ('like', 'superlike')`,
      [target, req.userId]
    );

    if (!reciprocal) {
      // Pas encore de match mutuel -> Envoyer une notification temps réel "Quelqu'un t'a liké" !
      io.to(`user_${target}`).emit('incoming_like', {
        fromUser: { ...me, online: isUserOnline(me.id) },
        direction,
        icebreaker: cleanIcebreaker,
        icebreakerTarget: cleanTarget
      });
      return res.json({ matched: false });
    }

    // Création du match mutuel
    const u1 = Math.min(req.userId, target);
    const u2 = Math.max(req.userId, target);
    await dbRun(
      `INSERT INTO matches (user1_id, user2_id) VALUES (?, ?) ON CONFLICT(user1_id, user2_id) DO NOTHING`,
      [u1, u2]
    );
    const matchRow = await dbGet(
      `SELECT id FROM matches WHERE user1_id = ? AND user2_id = ?`,
      [u1, u2]
    );

    // Si l'un des deux avait envoyé un brise-glace avant le match, l'insérer automatiquement dans le chat !
    const existingMsgCount = await dbGet(`SELECT COUNT(*) as total FROM messages WHERE match_id = ?`, [matchRow.id]);
    if (existingMsgCount && Number(existingMsgCount.total) === 0) {
      if (reciprocal.icebreaker) {
        const prefix = reciprocal.icebreaker_target ? `[Brise-glace sur ${reciprocal.icebreaker_target}] ` : '';
        await dbRun(
          `INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)`,
          [matchRow.id, target, `${prefix}${reciprocal.icebreaker}`]
        );
      }
      if (cleanIcebreaker) {
        const prefix = cleanTarget ? `[Brise-glace sur ${cleanTarget}] ` : '';
        await dbRun(
          `INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)`,
          [matchRow.id, req.userId, `${prefix}${cleanIcebreaker}`]
        );
      }
    }

    const mePayload = { ...me, online: isUserOnline(me.id) };
    const partnerPayload = { ...partner, online: isUserOnline(partner.id) };

    io.to(`user_${target}`).emit('new_match', { matchId: matchRow.id, partner: mePayload });
    io.to(`user_${req.userId}`).emit('new_match', { matchId: matchRow.id, partner: partnerPayload });

    res.json({ matched: true, matchId: matchRow.id, partner: partnerPayload });
  } catch (err) {
    console.error('Erreur swipe:', err);
    res.status(500).json({ error: 'Erreur lors du swipe.' });
  }
});

// Liste des matchs
app.get('/api/matches', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        m.id as match_id,
        m.created_at as matched_at,
        u.id as partner_id,
        u.name,
        u.age,
        u.city,
        u.job,
        u.photo_url,
        (SELECT content FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) as last_message_at
      FROM matches m
      JOIN users u ON u.id = CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END
      WHERE m.user1_id = ? OR m.user2_id = ?
      ORDER BY COALESCE(last_message_at, m.created_at) DESC
      `,
      [req.userId, req.userId, req.userId]
    );
    const matches = rows.map((m) => ({
      ...m,
      online: isUserOnline(m.partner_id)
    }));
    res.json({ matches });
  } catch (err) {
    console.error('Erreur liste matchs:', err);
    res.status(500).json({ error: 'Impossible de charger les matchs.' });
  }
});

// Historique des messages d'un match
app.get('/api/matches/:matchId/messages', authMiddleware, async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    const match = await dbGet(
      `SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)`,
      [matchId, req.userId, req.userId]
    );
    if (!match) return res.status(403).json({ error: 'Accès refusé à cette conversation.' });

    const messages = await dbAll(
      `SELECT id, match_id, sender_id, content, created_at FROM messages WHERE match_id = ? ORDER BY id ASC`,
      [matchId]
    );
    res.json({ messages });
  } catch (err) {
    console.error('Erreur messages:', err);
    res.status(500).json({ error: 'Impossible de charger les messages.' });
  }
});

// Envoyer un message
app.post('/api/matches/:matchId/messages', authMiddleware, async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message vide.' });

    const match = await dbGet(
      `SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)`,
      [matchId, req.userId, req.userId]
    );
    if (!match) return res.status(403).json({ error: 'Accès refusé.' });

    const result = await dbRun(
      `INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)`,
      [matchId, req.userId, content]
    );

    const saved = result.lastID
      ? await dbGet(`SELECT * FROM messages WHERE id = ?`, [result.lastID])
      : await dbGet(`SELECT * FROM messages WHERE match_id = ? AND sender_id = ? ORDER BY id DESC LIMIT 1`, [matchId, req.userId]);

    const partnerId = Number(match.user1_id) === req.userId ? match.user2_id : match.user1_id;

    io.to(`match_${matchId}`).emit('new_message', saved);
    io.to(`user_${partnerId}`).emit('message_notification', { matchId, message: saved });

    res.status(201).json({ message: saved });
  } catch (err) {
    console.error('Erreur envoi message:', err);
    res.status(500).json({ error: 'Impossible d’envoyer le message.' });
  }
});

// ==================== SOCKET.IO TEMPS RÉEL ====================

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Non authentifié'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = Number(payload.userId);
    next();
  } catch {
    next(new Error('Token invalide'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  socket.join(`user_${uid}`);

  // Enregistrer la présence en ligne
  if (!onlineSockets.has(uid)) {
    onlineSockets.set(uid, new Set());
  }
  const userSockets = onlineSockets.get(uid);
  const wasOffline = userSockets.size === 0;
  userSockets.add(socket.id);

  // Envoyer la liste des connectés au client qui vient d'arriver
  socket.emit('online_users', getOnlineUserIds());
  if (wasOffline) {
    io.emit('user_status', { userId: uid, online: true });
  }

  socket.on('join_match', (matchId) => {
    socket.join(`match_${matchId}`);
  });

  socket.on('typing', ({ matchId, isTyping }) => {
    socket.to(`match_${matchId}`).emit('partner_typing', {
      matchId,
      userId: uid,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    const set = onlineSockets.get(uid);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        onlineSockets.delete(uid);
        io.emit('user_status', { userId: uid, online: false });
      }
    }
  });
});

// Lancement du serveur
initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Serveur Étincelle actif sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Échec initialisation BDD:', err);
    process.exit(1);
  });
