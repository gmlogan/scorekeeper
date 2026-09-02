const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbDir = __dirname;
const dbPath = path.join(dbDir, 'scorekeeper.db');
const schemaPath = path.join(dbDir, 'schema.sql');

// Ensure database directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('Created database directory:', dbDir);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database at:', dbPath);
});

// Read and execute schema
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema, (err) => {
  if (err) {
    console.error('Error initializing database:', err);
    process.exit(1);
  }
  console.log('Database schema initialized successfully');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
      process.exit(1);
    }
    process.exit(0);
  });
});
