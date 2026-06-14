require('dotenv').config();

const { pool } = require('../backend/src/db');
const { syncGoogleSheet } = require('../backend/src/services/googleSheetSync');

(async () => {
  try {
    console.log('Mula sync Google Sheet...');
    const result = await syncGoogleSheet();
    console.log('Sync berjaya:', result);
  } catch (err) {
    console.error('Sync gagal:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
})();
