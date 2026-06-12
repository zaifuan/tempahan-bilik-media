#!/usr/bin/env node
// ============================================================
// scripts/init-db.js — Setup database (run schema.sql)
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/src/db');

(async () => {
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  console.log('⚙  Setup database...');
  console.log(`   Schema: ${schemaPath}`);
  console.log(`   DB:     ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

  try {
    await pool.query(sql);
    console.log('✅ Schema berjaya diaplikasi.');
    console.log('\nLangkah seterusnya:');
    console.log('  1. npm run import-excel -- /path/ke/data.xlsx');
    console.log('  2. npm run create-admin');
    console.log('  3. npm start');
  } catch (e) {
    console.error('❌ Gagal:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
