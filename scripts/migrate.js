const { Client } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

async function migrate() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('Connected to Neon database successfully.');

  const sql = `
CREATE TABLE IF NOT EXISTS datasets (
  id text PRIMARY KEY,
  name text NOT NULL,
  file_path text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  total_cols integer NOT NULL DEFAULT 0,
  file_bytes integer NOT NULL DEFAULT 0,
  is_demo integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id serial PRIMARY KEY,
  dataset_id text NOT NULL,
  position integer NOT NULL,
  op jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id serial PRIMARY KEY,
  dataset_id text,
  role text NOT NULL,
  content text NOT NULL,
  actions jsonb,
  created_at timestamp NOT NULL DEFAULT NOW()
);
`;

  await client.query(sql);
  console.log('Schema tables created successfully.');

  const res = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Public tables in Neon:', res.rows.map(r => r.table_name));

  await client.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
