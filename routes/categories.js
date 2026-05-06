const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/categories
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(rows);
});

// POST /api/categories
router.post('/', (req, res) => {
  const { name, colour = '#888888' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('INSERT INTO categories (name, colour) VALUES (?, ?)').run(name, colour);
    res.status(201).json({ id: result.lastInsertRowid, name, colour });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'name already exists' });
    }
    throw err;
  }
});

// PUT /api/categories/:id
router.put('/:id', (req, res) => {
  const { name, colour } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  try {
    db.prepare('UPDATE categories SET name = ?, colour = ? WHERE id = ?')
      .run(name ?? existing.name, colour ?? existing.colour, req.params.id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'name already exists' });
    }
    throw err;
  }
  res.json({ id: Number(req.params.id), name: name ?? existing.name, colour: colour ?? existing.colour });
});

// DELETE /api/categories/:id
router.delete('/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE category_id = ?').get(req.params.id);
  if (used.c > 0) return res.status(409).json({ error: 'Category in use by transactions' });
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
