require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// ========================
// ENV CHECK (VERY IMPORTANT)
// ========================
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "YES" : "NO");
console.log("JWT_SECRET:", process.env.JWT_SECRET ? "YES" : "NO");

// ========================
// DATABASE
// ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('connect', () => console.log('✅ DB connected'));
pool.on('error', (err) => console.error('❌ DB error', err));

// ========================
// AUTH MIDDLEWARE
// ========================
function auth(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.replace('Bearer ', '');

    req.user = jwt.verify(token, process.env.JWT_SECRET);

    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ========================
// HEALTH CHECK
// ========================
app.get('/', (req, res) => {
  res.json({ status: 'Guitapp API running 🎸' });
});

// ========================
// AUTH
// ========================
app.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO users(username,email,password_hash,display_name)
       VALUES($1,$2,$3,$4)
       RETURNING user_id, username, email, display_name`,
      [username, email, hash, display_name]
    );

    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email=$1',
      [email]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { user_id: user.user_id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// CHORDS
// ========================
app.get('/chords', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM chords ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SONGS
// ========================
app.get('/songs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM songs WHERE is_public=true ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/songs/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM songs WHERE song_id=$1',
      [req.params.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/songs', auth, async (req, res) => {
  try {
    const {
      title, artist, album, genre,
      key_signature, bpm, lyrics, chord_sheet
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO songs
      (title,artist,album,genre,key_signature,bpm,lyrics,chord_sheet,uploaded_by,is_public)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
      RETURNING *`,
      [
        title, artist, album, genre,
        key_signature, bpm, lyrics,
        chord_sheet, req.user.user_id
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// FAVORITES
// ========================
app.get('/favorites', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*
       FROM favorites f
       JOIN songs s ON s.song_id = f.song_id
       WHERE f.user_id=$1`,
      [req.user.user_id]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/favorites/:songId', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO favorites(user_id,song_id)
       VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [req.user.user_id, req.params.songId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/favorites/:songId', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM favorites WHERE user_id=$1 AND song_id=$2',
      [req.user.user_id, req.params.songId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// DOWNLOADS
// ========================
app.get('/downloads', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*
       FROM downloads d
       JOIN songs s ON s.song_id = d.song_id
       WHERE d.user_id=$1`,
      [req.user.user_id]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/downloads/:songId', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO downloads(user_id,song_id)
       VALUES($1,$2)
       ON CONFLICT (user_id,song_id)
       DO UPDATE SET downloaded_at=NOW()`,
      [req.user.user_id, req.params.songId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// START SERVER
// ========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🎸 API running on port ${PORT}`);
});