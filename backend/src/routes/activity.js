const express = require('express');
const { query } = require('../db');
const { requireRole, ADMINS } = require('../middleware/auth');

const router = express.Router();

// GET /api/activity?entity=&user=&limit=  (admin only) — system activity log
router.get('/', requireRole(ADMINS), async (req, res) => {
  const { entity, user } = req.query;
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const where = [], params = [];
  if (entity) { where.push('entity = ?'); params.push(entity); }
  if (user) { where.push('user_name LIKE ?'); params.push(`%${user}%`); }
  const rows = await query(
    `SELECT id, user_name, user_role, method, path, entity, status, ip, detail, created_at
     FROM activity_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC LIMIT ?`,
    [...params, limit]
  ).catch(() => []);
  res.json({ rows });
});

module.exports = router;
