const path = require('path');
const { Sequelize } = require('sequelize');

// DB config resolution. Load a local .env file if one exists (handy for local dev) and merge it OVER
// process.env, then fall back to process.env for anything not in the file. On a managed host
// (Render / Railway / etc.) there is no .env file on disk — config is injected purely via process.env,
// which the fallback below picks up automatically.
const fileEnv = require('dotenv').config({ path: path.join(__dirname, '..', '.env') }).parsed || {};
const env = { ...process.env, ...fileEnv };

// Managed MySQL providers (Aiven, TiDB Cloud, PlanetScale, etc.) require a TLS connection. Set
// DB_SSL=true in that environment. Leave it unset for a local/self-hosted MySQL that speaks plaintext.
const useSsl = String(env.DB_SSL).toLowerCase() === 'true';

const sequelize = new Sequelize(
  env.DB_NAME || 'sales_crm',
  env.DB_USER || 'root',
  env.DB_PASSWORD || '',
  {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
    define: { timestamps: true, underscored: false },
    // rejectUnauthorized:false accepts the provider's server cert without pinning a CA file — fine for
    // a demo. To verify the chain, use ssl: { ca: fs.readFileSync('<provider-ca>.pem') } instead.
    ...(useSsl ? { dialectOptions: { ssl: { rejectUnauthorized: false } } } : {}),
  }
);

module.exports = sequelize;
