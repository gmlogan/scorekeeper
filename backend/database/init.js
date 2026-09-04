// Delegates to Database.connect() rather than execing schema.sql directly,
// so `npm run init-db` can't produce a db that's missing migrations (it used
// to exec schema.sql and stop — leaving `user_version=0` with none of the
// forward-only migrations in `models/database.js` applied).
const Database = require('../src/models/database');

const db = new Database();
db.connect()
  .then(() => db.close())
  .then(() => {
    console.log('Database initialized at:', db.dbPath);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error initializing database:', err);
    process.exit(1);
  });
