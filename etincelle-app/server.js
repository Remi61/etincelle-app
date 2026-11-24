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

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.get('/healthz', (_req, res) => res.status(200).send('OK'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont autorisées.'));
  }
});

// ==================== BASE DE DONNÉES (SQLITE / POSTGRESQL) ====================

let pgPool = null;
let sqliteDb = null;

if (isPg) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  console.log('Mode base de données : PostgreSQL Cloud');
} else {
  const sqlite3 = require('sqlite3').verbose();
  sqliteDb = new sqlite3.Database(path.join(dataDir, 'etincelle.db'));
  console.log('Mode base de données : SQLite local');
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

function parsePhotosList(u) {
  let arr = [];
  if (u && u.photos_json) {
    try {
      const parsed = JSON.parse(u.photos_json);
      if (Array.isArray(parsed)) arr = parsed.filter(Boolean);
    } catch (_) {}
  }
  if (arr.length === 0 && u && u.photo_url) {
    arr = [u.photo_url];
  }
  return arr;
}

// ==================== PROFILS PRÉ-CRÉÉS (18-25 ANS, MULTI-PHOTOS) ====================

const SEED_PROFILES = [
  {
    email: 'lea.martin@etincelle.fr',
    name: 'Léa',
    age: 21,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Paris',
    job: 'Étudiante en droit',
    bio: 'Team brunch le dimanche, expos photos et soirées improvisées entre copines ✨',
    interests: 'Voyages, Mode, Cinéma, Café',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'manon.dubois@etincelle.fr',
    name: 'Manon',
    age: 22,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Lyon',
    job: 'Architecte d’intérieur junior',
    bio: 'Toujours à la recherche du meilleur matcha de la ville et d’un bon film le soir 🎬',
    interests: 'Déco, Matcha, Randonnée, Séries',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'ines.benali@etincelle.fr',
    name: 'Inès',
    age: 20,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Bordeaux',
    job: 'Étudiante en communication',
    bio: 'J’adore les couchers de soleil sur les quais, la musique et les road trips 🌅',
    interests: 'Musique, Plage, Festivals, Photo',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1504703395950-b89145a5425b?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'clara.moreau@etincelle.fr',
    name: 'Clara',
    age: 23,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Nantes',
    job: 'Graphiste & Illustratrice',
    bio: 'Un peu rêveuse, fan de concerts indie et de crêpes salées. Fais-moi rire !',
    interests: 'Dessin, Concerts, Cuisine, Voyages',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1464863979621-258859e62245?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'jade.laurent@etincelle.fr',
    name: 'Jade',
    age: 19,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Lille',
    job: 'Étudiante en psychologie',
    bio: 'Nouvelle sur l’appli 👀 J’aime les gens simples, les balades et les bons restos.',
    interests: 'Psychologie, Restos, Danse, Lecture',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'emma.bernard@etincelle.fr',
    name: 'Emma',
    age: 24,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Toulouse',
    job: 'Infirmière',
    bio: 'Entre deux gardes, j’adore profiter du soleil en terrasse ou partir en week-end ☀️',
    interests: 'Sport, Soleil, Voyages, Pâtisserie',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'lina.khelifi@etincelle.fr',
    name: 'Lina',
    age: 18,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Montpellier',
    job: 'Étudiante en langues',
    bio: 'Passionnée d’espagnol, de plage et de soirées chill avec une bonne playlist 🎶',
    interests: 'Langues, Plage, R&B, Cinéma',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'zoe.richard@etincelle.fr',
    name: 'Zoé',
    age: 22,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Marseille',
    job: 'Photographe freelance',
    bio: 'Les calanques le matin, un verre sur le port le soir. Qui m’accompagne ? 📸',
    interests: 'Photographie, Mer, Yoga, Sushi',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1502767089025-6572583495f9?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1496440737103-cd596325d314?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1523264653568-d3d4032d1476?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'sarah.petit@etincelle.fr',
    name: 'Sarah',
    age: 25,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Nice',
    job: 'Chargée d’événementiel',
    bio: 'Spontanée, souriante et toujours partante pour découvrir de nouveaux endroits ✨',
    interests: 'Événementiel, Voyages, Cocktails, Running',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1513956589380-bad6acb9b9d4?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1503185912284-5271ff81b9a8?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1485875437342-9b39470b3d95?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'louise.garcia@etincelle.fr',
    name: 'Louise',
    age: 21,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Rennes',
    job: 'Étudiante en marketing',
    bio: 'Fan de friperies, de festivals et de discussions jusqu’à 3h du matin 🌙',
    interests: 'Friperies, Festivals, Astrologie, Café',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1512310604669-443f26c35f52?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'romane.leroy@etincelle.fr',
    name: 'Romane',
    age: 20,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Strasbourg',
    job: 'Étudiante en médecine',
    bio: 'Beaucoup de cours la semaine mais toujours motivée pour décompresser le week-end !',
    interests: 'Médecine, Natation, Cinéma, Voyages',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'alice.fontaine@etincelle.fr',
    name: 'Alice',
    age: 19,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Caen',
    job: 'Étudiante en design',
    bio: 'Week-ends à Deauville, dessin sur iPad et amateur de bons burgers 🍔',
    interests: 'Design, Mer, Burgers, Musique',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'eva.rousseau@etincelle.fr',
    name: 'Eva',
    age: 23,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Paris',
    job: 'Styliste assistant',
    bio: 'Accro aux sneakers, aux musées gratuits le dimanche et aux voyages improvisés ✈️',
    interests: 'Mode, Sneakers, Art, Voyages',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'juliette.simon@etincelle.fr',
    name: 'Juliette',
    age: 25,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Lyon',
    job: 'Kinésithérapeute',
    bio: 'Sportive mais très gourmande. Si tu connais une bonne adresse italienne, écris-moi 🍝',
    interests: 'Fitness, Cuisine italienne, Ski, Séries',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'chloe.mercier@etincelle.fr',
    name: 'Chloé',
    age: 24,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Bordeaux',
    job: 'Community Manager',
    bio: 'Team océan, surf le week-end et soirées jeux de société entre amis 🎲',
    interests: 'Surf, Réseaux, Jeux, Concerts',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1464863979621-258859e62245?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1504703395950-b89145a5425b?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'nina.chevalier@etincelle.fr',
    name: 'Nina',
    age: 21,
    gender: 'femme',
    interested_in: 'tous',
    city: 'Paris',
    job: 'Étudiante en cinéma',
    bio: 'Toujours un casque sur les oreilles. Dis-moi ton film préféré et je te juge 😉',
    interests: 'Cinéma, Musique, Photos argentiques, Café',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=800&q=80'
    ]
  },
  {
    email: 'lucas@demo.fr',
    name: 'Lucas',
    age: 24,
    gender: 'homme',
    interested_in: 'tous',
    city: 'Lyon',
    job: 'Développeur & Photographe',
    bio: 'Toujours partant pour découvrir une nouvelle adresse resto ou partir un week-end.',
    interests: 'Photo, Cuisine, Escalade, Musique',
    is_bot: 1,
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80'
    ]
  }
];

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
      photos_json TEXT DEFAULT '[]',
      is_bot INTEGER DEFAULT 0,
      created_at ${timeType}
    )
  `);

  // Migrations douces si tables déjà existantes
  try { await dbRun(`ALTER TABLE users ADD COLUMN photos_json TEXT DEFAULT '[]'`); } catch (_) {}
  try { await dbRun(`ALTER TABLE users ADD COLUMN is_bot INTEGER DEFAULT 0`); } catch (_) {}

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

  try { await dbRun(`ALTER TABLE swipes ADD COLUMN icebreaker TEXT DEFAULT ''`); } catch (_) {}
  try { await dbRun(`ALTER TABLE swipes ADD COLUMN icebreaker_target TEXT DEFAULT ''`); } catch (_) {}

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
    const demoPass = await bcrypt.hash('demo1234', 10);
    for (const u of SEED_PROFILES) {
      const existing = await dbGet('SELECT id FROM users WHERE email = ?', [u.email]);
      const photosJson = JSON.stringify(u.photos);
      if (!existing) {
        await dbRun(
          `INSERT INTO users (email, password_hash, name, age, gender, interested_in, city, job, bio, interests, photo_url, photos_json, is_bot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.email, demoPass, u.name, u.age, u.gender, u.interested_in, u.city, u.job, u.bio, u.interests, u.photos[0], photosJson, u.is_bot]
        );
      } else {
        await dbRun(
          `UPDATE users SET photos_json = ?, is_bot = ? WHERE id = ? AND (photos_json IS NULL OR photos_json = '[]' OR photos_json = '')`,
          [photosJson, u.is_bot, existing.id]
        );
      }
    }
    console.log(`${SEED_PROFILES.length} profils prêts dans la base.`);
  }
}

// ==================== PRÉSENCE TEMPS RÉEL (HUMAINS + PROFILS ACTIFS) ====================

const onlineSockets = new Map(); // userId -> Set<socketId>
const simulatedOnlineIds = new Set();

async function initSimulatedPresence() {
  try {
    const bots = await dbAll('SELECT id FROM users WHERE is_bot = 1');
    bots.forEach((b) => {
      if (Math.random() < 0.72) {
        simulatedOnlineIds.add(Number(b.id));
      }
    });

    // Rotation naturelle en arrière-plan toutes les 50 secondes
    setInterval(async () => {
      try {
        const allBots = await dbAll('SELECT id FROM users WHERE is_bot = 1');
        if (!allBots.length) return;
        const pick = allBots[Math.floor(Math.random() * allBots.length)];
        const bid = Number(pick.id);
        if (simulatedOnlineIds.has(bid)) {
          simulatedOnlineIds.delete(bid);
          io.emit('user_status', { userId: bid, online: false });
        } else {
          simulatedOnlineIds.add(bid);
          io.emit('user_status', { userId: bid, online: true });
        }
      } catch (_) {}
    }, 50000);
  } catch (_) {}
}

function isUserOnline(userId) {
  const uid = Number(userId);
  const set = onlineSockets.get(uid);
  return Boolean((set && set.size > 0) || simulatedOnlineIds.has(uid));
}

function getOnlineUserIds() {
  const all = new Set([...onlineSockets.keys(), ...simulatedOnlineIds]);
  return Array.from(all);
}

// ==================== MOTEUR DE RÉPONSE NATURELLE ====================

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildNaturalReply(bot, userMessage, history = [], icebreakerContext = null) {
  const text = (userMessage || '').trim();
  const lower = text.toLowerCase();
  const prevBotTexts = new Set(
    history.filter((m) => Number(m.sender_id) === Number(bot.id)).map((m) => m.content.trim().toLowerCase())
  );

  const interestsList = (bot.interests || '').split(',').map((s) => s.trim()).filter(Boolean);
  const firstInterest = interestsList[0] || 'les voyages';
  const secondInterest = interestsList[1] || 'la musique';

  const candidates = [];

  // 1. Réaction directe si c'est le tout premier message après un brise-glace
  if (icebreakerContext) {
    candidates.push(
      `Haha merci pour ton petit mot ! 😊 Ça m'a fait sourire, tu fais quoi de beau aujourd'hui ?`,
      `Merci c'est super gentil ! ✨ T'as l'air sympa toi aussi, tu es de quel coin ?`,
      `Aww merciii 😊 J'avoue que j'aime bien cette photo aussi haha. Tu passes une bonne journée ?`
    );
  }

  // 2. Salutations / prise de contact
  if (/^(salut|coucou|hello|hey|yo|bonsoir|bonjour|cc|slt)\b/i.test(lower) || lower.length <= 12) {
    candidates.push(
      `Coucou ! 😊 Ça va ?`,
      `Hey ! Comment tu vas aujourd'hui ? ✨`,
      `Salut toi ! Ça va bien ? Tu fais quoi de beau ?`,
      `Coucou 😊 Merci pour le match ! Tu es d'où toi ?`
    );
  }

  // 3. Question "ça va / comment tu vas"
  if (/(ça va|ca va|comment tu vas|tu vas bien|cv\??)/i.test(lower)) {
    candidates.push(
      `Ça va super bien merci et toi ? 😊 Tu passes une bonne journée ?`,
      `Tranquille et toi ? Je viens juste de me poser un peu haha`,
      `Très bien merci ! ✨ Tu fais quoi de beau de ta journée ?`
    );
  }

  // 4. Question sur sa ville / localisation
  if (/(habites|ville|d'où|d'ou|coin|région|paris|lyon|bordeaux|nantes|lille|toulouse|marseille|nice|caen)/i.test(lower)) {
    candidates.push(
      `Je suis sur ${bot.city || 'Paris'} ! Et toi tu es dans quel coin ? 😊`,
      `Moi je suis de ${bot.city || 'Paris'} ✨ Tu connais un peu ou t'es loin ?`,
      `Sur ${bot.city || 'Paris'} ! Et toi tu bouges souvent ?`
    );
  }

  // 5. Question sur ses études / métier / occupation
  if (/(fais quoi|travail|boulot|métier|metier|études|etudes|étudies|occupe)/i.test(lower)) {
    candidates.push(
      `Moi je suis ${(bot.job || 'étudiante').toLowerCase()} 😊 Et toi tu fais quoi dans la vie ?`,
      `En ce moment je suis ${(bot.job || 'en cours').toLowerCase()}, ça me prend pas mal de temps mais j'adore ! Et toi ?`,
      `${bot.job || 'Étudiante'} ! ✨ Et toi tu bosses ou t'es encore dans les études ?`
    );
  }

  // 6. Question sur ses passions / intérêts
  if (/(passion|aimes|aime|hobby|hobbies|temps libre|week-end|weekend|film|musique|sport|voyage)/i.test(lower)) {
    candidates.push(
      `Franchement j'adore ${firstInterest.toLowerCase()} et ${secondInterest.toLowerCase()} 😊 Et toi c'est quoi tes trucs préférés ?`,
      `Quand j'ai du temps libre c'est souvent ${firstInterest.toLowerCase()} ou sortir avec mes potes haha. Tu aimes quoi toi ?`,
      `Je suis fan de ${firstInterest.toLowerCase()} ! ✨ Dis-moi ce que tu aimes faire le week-end`
    );
  }

  // 7. Compliment physique / photo / profil
  if (/(belle|jolie|canon|magnifique|charmante|mignonne|sourire|yeux|photo|profil|style)/i.test(lower)) {
    candidates.push(
      `Haha merciii c'est trop gentil 😊 Tu me fais rougir là !`,
      `Merci beaucoup ✨ Ton profil est super sympa aussi !`,
      `C'est adorable merci 😊 Tu dis ça à toutes tes matchs ou j'ai de la chance ? 😉`
    );
  }

  // 8. Proposition de verre / café / rencontre / réseaux
  if (/(verre|café|cafe|boire|sortir|voir|rencontrer|ce soir|demain|insta|instagram|snap|numéro|numero)/i.test(lower)) {
    candidates.push(
      `Haha t'es direct toi 😉 On apprend déjà à se connaître un petit peu ici et pourquoi pas autour d'un verre !`,
      `Pourquoi pas un de ces jours autour d'un café 😊 Tu fais quoi de beau cette semaine déjà ?`,
      `On discute encore un peu ici pour voir si le feeling passe bien et après avec plaisir ✨`
    );
  }

  // 9. Relances naturelles variées si message général ou question ouverte
  candidates.push(
    `Haha grave ! Et sinon tu recherches quoi de beau ici ? 😊`,
    `J'avoue 😄 Tu fais quoi de prévu pour ton week-end toi ?`,
    `Carrément ! Au fait tu es de quel coin exactement ? ✨`,
    `Trop bien ça ! Tu écoutes quoi comme style de musique en ce moment ? 🎶`,
    `Haha pas mal ! Dis-m'en un peu plus sur toi, tu fais quoi dans la vie ? 😊`,
    `Franchement oui ! Et toi t'es plutôt team soirées posées ou sorties improvisées ?`
  );

  // Filtrer les réponses déjà utilisées dans cette conversation
  const fresh = candidates.filter((c) => !prevBotTexts.has(c.trim().toLowerCase()));
  return fresh.length > 0 ? pickRandom(fresh) : pickRandom(candidates);
}

const pendingBotTimers = new Map(); // matchId -> timeoutId

function scheduleBotReply(matchId, botUser, userMessage, icebreakerContext = null) {
  if (pendingBotTimers.has(matchId)) {
    clearTimeout(pendingBotTimers.get(matchId));
  }

  // S'assurer que la personne apparaît "En ligne" pendant qu'elle répond
  if (!simulatedOnlineIds.has(Number(botUser.id))) {
    simulatedOnlineIds.add(Number(botUser.id));
    io.emit('user_status', { userId: Number(botUser.id), online: true });
  }

  const readDelay = 2000 + Math.floor(Math.random() * 2500);

  const timer = setTimeout(async () => {
    try {
      const history = await dbAll(
        `SELECT sender_id, content FROM messages WHERE match_id = ? ORDER BY id ASC`,
        [matchId]
      );
      const replyText = buildNaturalReply(botUser, userMessage, history, icebreakerContext);

      // Démarrer l'indicateur "En train d'écrire..."
      io.to(`match_${matchId}`).emit('partner_typing', {
        matchId,
        userId: Number(botUser.id),
        isTyping: true
      });

      const typingDuration = Math.min(5200, Math.max(2200, replyText.length * 55));

      setTimeout(async () => {
        try {
          io.to(`match_${matchId}`).emit('partner_typing', {
            matchId,
            userId: Number(botUser.id),
            isTyping: false
          });

          const matchRow = await dbGet(`SELECT * FROM matches WHERE id = ?`, [matchId]);
          if (!matchRow) return;

          const humanId = Number(matchRow.user1_id) === Number(botUser.id)
            ? Number(matchRow.user2_id)
            : Number(matchRow.user1_id);

          const result = await dbRun(
            `INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)`,
            [matchId, Number(botUser.id), replyText]
          );

          const saved = result.lastID
            ? await dbGet(`SELECT * FROM messages WHERE id = ?`, [result.lastID])
            : await dbGet(`SELECT * FROM messages WHERE match_id = ? AND sender_id = ? ORDER BY id DESC LIMIT 1`, [matchId, Number(botUser.id)]);

          io.to(`match_${matchId}`).emit('new_message', saved);
          io.to(`user_${humanId}`).emit('message_notification', { matchId, message: saved });
          pendingBotTimers.delete(matchId);
        } catch (err) {
          console.error('Erreur envoi réponse auto:', err);
        }
      }, typingDuration);
    } catch (err) {
      console.error('Erreur préparation réponse auto:', err);
    }
  }, readDelay);

  pendingBotTimers.set(matchId, timer);
}

// ==================== MIDDLEWARES & HELPERS ====================

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
  const { password_hash, is_bot, ...safe } = u;
  const photos = parsePhotosList(u);
  return {
    ...safe,
    photo_url: photos[0] || u.photo_url || '',
    photos,
    online: isUserOnline(u.id)
  };
}

function resolvePhotosArray(req, currentPhotos = [], fallbackAvatar = '') {
  if (Array.isArray(req.body.photos_data) && req.body.photos_data.length > 0) {
    const valid = req.body.photos_data
      .filter((p) => typeof p === 'string' && (p.startsWith('data:image/') || p.startsWith('http')))
      .slice(0, 6);
    if (valid.length > 0) return valid;
  }
  if (req.body && req.body.photo_data && req.body.photo_data.startsWith('data:image/')) {
    return [req.body.photo_data, ...currentPhotos.slice(1)].filter(Boolean);
  }
  if (req.file && req.file.buffer) {
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    return [b64, ...currentPhotos.slice(1)].filter(Boolean);
  }
  if (currentPhotos.length > 0) return currentPhotos;
  return fallbackAvatar ? [fallbackAvatar] : [];
}

// ==================== ROUTES API ====================

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
    const photos = resolvePhotosArray(req, [], defaultAvatar);

    const result = await dbRun(
      `INSERT INTO users (email, password_hash, name, age, gender, interested_in, city, job, bio, interests, photo_url, photos_json, is_bot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
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
        photos[0],
        JSON.stringify(photos)
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

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ user: sanitizeUser(user) });
});

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

    const currentPhotos = parsePhotosList(current);
    const photos = resolvePhotosArray(req, currentPhotos, current.photo_url);

    await dbRun(
      `UPDATE users SET name=?, age=?, gender=?, interested_in=?, city=?, job=?, bio=?, interests=?, photo_url=?, photos_json=? WHERE id=?`,
      [name, age, gender, interested_in, city, job, bio, interests, photos[0] || current.photo_url, JSON.stringify(photos), req.userId]
    );

    const updated = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error('Erreur update profil:', err);
    res.status(500).json({ error: 'Impossible de mettre à jour le profil.' });
  }
});

// Profils à découvrir (avec galerie photos[] + pastille En ligne)
app.get('/api/discover', authMiddleware, async (req, res) => {
  try {
    const me = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!me) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    let query = `
      SELECT
        u.id, u.name, u.age, u.gender, u.city, u.job, u.bio, u.interests, u.photo_url, u.photos_json,
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

    query += ` ORDER BY (CASE WHEN s.id IS NOT NULL THEN 0 ELSE 1 END), u.id ASC LIMIT 60`;
    const rows = await dbAll(query, params);
    const profiles = rows.map((p) => {
      const photos = parsePhotosList(p);
      const { photos_json, ...rest } = p;
      return {
        ...rest,
        photo_url: photos[0] || p.photo_url,
        photos,
        online: isUserOnline(p.id)
      };
    });
    res.json({ profiles });
  } catch (err) {
    console.error('Erreur discover:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des profils.' });
  }
});

// Likes / brise-glaces reçus
app.get('/api/likes-received', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        u.id, u.name, u.age, u.city, u.job, u.bio, u.interests, u.photo_url, u.photos_json,
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
      likes: rows.map((r) => {
        const photos = parsePhotosList(r);
        const { photos_json, ...rest } = r;
        return { ...rest, photo_url: photos[0] || r.photo_url, photos, online: isUserOnline(r.id) };
      })
    });
  } catch (err) {
    console.error('Erreur likes-received:', err);
    res.status(500).json({ error: 'Impossible de charger les likes reçus.' });
  }
});

// Swipe + Match + Réaction automatique naturelle
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
      `SELECT id, name, age, city, job, bio, interests, photo_url, photos_json FROM users WHERE id = ?`,
      [req.userId]
    );
    const partner = await dbGet(
      `SELECT id, name, age, city, job, bio, interests, photo_url, photos_json, is_bot FROM users WHERE id = ?`,
      [target]
    );

    const reciprocal = await dbGet(
      `SELECT id, icebreaker, icebreaker_target FROM swipes WHERE swiper_id = ? AND target_id = ? AND direction IN ('like', 'superlike')`,
      [target, req.userId]
    );

    // Si la personne ciblée est un profil pré-créé et n'a pas encore liké, déclencher un match naturel après un court délai
    if (!reciprocal && partner && Number(partner.is_bot) === 1) {
      const willMatch = direction === 'superlike' || Boolean(cleanIcebreaker) || Math.random() < 0.88;
      if (willMatch) {
        const matchDelay = 1800 + Math.floor(Math.random() * 2600);
        setTimeout(async () => {
          try {
            await dbRun(
              `INSERT INTO swipes (swiper_id, target_id, direction) VALUES (?, ?, 'like')
               ON CONFLICT(swiper_id, target_id) DO UPDATE SET direction = 'like'`,
              [target, req.userId]
            );
            const u1 = Math.min(req.userId, target);
            const u2 = Math.max(req.userId, target);
            await dbRun(
              `INSERT INTO matches (user1_id, user2_id) VALUES (?, ?) ON CONFLICT(user1_id, user2_id) DO NOTHING`,
              [u1, u2]
            );
            const matchRow = await dbGet(`SELECT id FROM matches WHERE user1_id = ? AND user2_id = ?`, [u1, u2]);
            if (!matchRow) return;

            if (cleanIcebreaker) {
              const prefix = cleanTarget ? `[Brise-glace sur ${cleanTarget}] ` : '';
              await dbRun(
                `INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)`,
                [matchRow.id, req.userId, `${prefix}${cleanIcebreaker}`]
              );
            }

            const partnerPayload = sanitizeUser(partner);
            io.to(`user_${req.userId}`).emit('new_match', { matchId: matchRow.id, partner: partnerPayload });

            // Si un brise-glace a été envoyé, elle y répond naturellement ; sinon ~60% de chance qu'elle écrive en premier
            if (cleanIcebreaker) {
              scheduleBotReply(matchRow.id, partner, cleanIcebreaker, cleanTarget);
            } else if (Math.random() < 0.62) {
              scheduleBotReply(matchRow.id, partner, 'salut', null);
            }
          } catch (e) {
            console.error('Erreur match différé:', e);
          }
        }, matchDelay);
      }
      return res.json({ matched: false });
    }

    if (!reciprocal) {
      io.to(`user_${target}`).emit('incoming_like', {
        fromUser: sanitizeUser(me),
        direction,
        icebreaker: cleanIcebreaker,
        icebreakerTarget: cleanTarget
      });
      return res.json({ matched: false });
    }

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

    const mePayload = sanitizeUser(me);
    const partnerPayload = sanitizeUser(partner);

    io.to(`user_${target}`).emit('new_match', { matchId: matchRow.id, partner: mePayload });
    io.to(`user_${req.userId}`).emit('new_match', { matchId: matchRow.id, partner: partnerPayload });

    if (partner && Number(partner.is_bot) === 1 && cleanIcebreaker) {
      scheduleBotReply(matchRow.id, partner, cleanIcebreaker, cleanTarget);
    }

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
        u.bio,
        u.interests,
        u.photo_url,
        u.photos_json,
        (SELECT content FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) as last_message_at
      FROM matches m
      JOIN users u ON u.id = CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END
      WHERE m.user1_id = ? OR m.user2_id = ?
      ORDER BY COALESCE(last_message_at, m.created_at) DESC
      `,
      [req.userId, req.userId, req.userId]
    );
    const matches = rows.map((m) => {
      const photos = parsePhotosList(m);
      const { photos_json, ...rest } = m;
      return {
        ...rest,
        photo_url: photos[0] || m.photo_url,
        photos,
        online: isUserOnline(m.partner_id)
      };
    });
    res.json({ matches });
  } catch (err) {
    console.error('Erreur liste matchs:', err);
    res.status(500).json({ error: 'Impossible de charger les matchs.' });
  }
});

// Historique des messages
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

// Envoyer un message (+ déclenchement réponse naturelle si le partenaire est un profil actif)
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

    const partnerId = Number(match.user1_id) === req.userId ? Number(match.user2_id) : Number(match.user1_id);

    io.to(`match_${matchId}`).emit('new_message', saved);
    io.to(`user_${partnerId}`).emit('message_notification', { matchId, message: saved });

    // Si le partenaire est un profil pré-créé, déclencher une réponse naturelle avec délai humain
    const partnerUser = await dbGet(`SELECT * FROM users WHERE id = ?`, [partnerId]);
    if (partnerUser && Number(partnerUser.is_bot) === 1) {
      scheduleBotReply(matchId, partnerUser, content, null);
    }

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

  if (!onlineSockets.has(uid)) {
    onlineSockets.set(uid, new Set());
  }
  const userSockets = onlineSockets.get(uid);
  const wasOffline = userSockets.size === 0;
  userSockets.add(socket.id);

  socket.emit('online_users', getOnlineUserIds());
  if (wasOffline) {
    io.emit('user_status', { userId: uid, online: true });
  }

  // Au bout de 18 secondes après la connexion, envoyer un like spontané d'un profil fille si pas encore reçu
  const introTimer = setTimeout(async () => {
    try {
      const me = await dbGet('SELECT * FROM users WHERE id = ?', [uid]);
      if (!me || Number(me.is_bot) === 1) return;
      const existingLikes = await dbGet('SELECT COUNT(*) as total FROM swipes WHERE target_id = ?', [uid]);
      if (existingLikes && Number(existingLikes.total) > 0) return;

      let genderFilter = '';
      const params = [uid, uid];
      if (me.interested_in === 'femme' || me.interested_in === 'homme') {
        genderFilter = 'AND u.gender = ?';
        params.push(me.interested_in);
      }

      const admirer = await dbGet(
        `SELECT u.* FROM users u
         WHERE u.is_bot = 1 AND u.id != ?
           AND u.id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = ?)
           ${genderFilter}
         ORDER BY RANDOM() LIMIT 1`,
        params
      );

      if (admirer) {
        const icebreakers = [
          'Ton profil a direct attiré mon attention 😊',
          'Salut ! On a l’air d’avoir pas mal de points communs ✨',
          'Super photo ! Tu es de quel coin ? 😊'
        ];
        const chosenIce = pickRandom(icebreakers);
        await dbRun(
          `INSERT INTO swipes (swiper_id, target_id, direction, icebreaker, icebreaker_target)
           VALUES (?, ?, 'like', ?, 'ton profil') ON CONFLICT(swiper_id, target_id) DO NOTHING`,
          [admirer.id, uid, chosenIce]
        );
        if (!simulatedOnlineIds.has(Number(admirer.id))) {
          simulatedOnlineIds.add(Number(admirer.id));
          io.emit('user_status', { userId: Number(admirer.id), online: true });
        }
        io.to(`user_${uid}`).emit('incoming_like', {
          fromUser: sanitizeUser(admirer),
          direction: 'like',
          icebreaker: chosenIce,
          icebreakerTarget: 'ton profil'
        });
      }
    } catch (_) {}
  }, 18000);

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
    clearTimeout(introTimer);
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

initDb()
  .then(async () => {
    await initSimulatedPresence();
    server.listen(PORT, () => {
      console.log(`Serveur Étincelle v3 actif sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Échec initialisation BDD:', err);
    process.exit(1);
  });
