// GET /api/health — quick check that functions run and whether the database is connected.
'use strict';
const { dbConfig } = require('./_lib');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, database: dbConfig() ? 'connected' : 'missing' }));
};
