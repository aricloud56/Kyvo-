// Environment configuration. Every external integration is optional so the app runs locally without credentials;
// missing settings are reported by /api/health and the admin dashboard.
import { parseDatabaseUrl, type PgConfig } from './lib/pg.js';

export interface Config {
  port: number;
  baseUrl: string;
  production: boolean;
  db: PgConfig;
  adminDb: PgConfig | null;
  sessionDays: number;
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
    priceMonthly: string | null;
    priceAnnual: string | null;
    apiBase: string;
  };
  storage: {
    driver: 'local' | 'supabase';
    localDir: string;
    supabaseUrl: string | null;
    supabaseServiceKey: string | null;
    bucket: string;
  };
  tiktokPixelId: string | null;
  /** Sign-in and sign-up attempts allowed per IP and per email in 15 minutes. */
  authRateLimit: number;
}

const env = (k: string): string | null => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  const get = (k: string) => overrides[k] ?? env(k);
  const dbUrl = get('DATABASE_URL') ?? 'postgres://kyvo_app:kyvo_app_dev@127.0.0.1:5433/kyvo_dev';
  const production = get('NODE_ENV') === 'production';
  const cfg: Config = {
    port: Number(get('PORT') ?? 3000),
    baseUrl: (get('APP_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, ''),
    production,
    db: parseDatabaseUrl(dbUrl, get('DATABASE_SSL') ?? undefined),
    adminDb: get('DATABASE_ADMIN_URL') ? parseDatabaseUrl(get('DATABASE_ADMIN_URL')!, get('DATABASE_SSL') ?? undefined) : null,
    sessionDays: Number(get('SESSION_DAYS') ?? 30),
    stripe: {
      secretKey: get('STRIPE_SECRET_KEY'),
      webhookSecret: get('STRIPE_WEBHOOK_SECRET'),
      priceMonthly: get('STRIPE_PRICE_MONTHLY'),
      priceAnnual: get('STRIPE_PRICE_ANNUAL'),
      apiBase: get('STRIPE_API_BASE') ?? 'https://api.stripe.com',
    },
    storage: {
      driver: get('STORAGE_DRIVER') === 'supabase' ? 'supabase' : 'local',
      localDir: get('STORAGE_DIR') ?? './storage',
      supabaseUrl: get('SUPABASE_URL'),
      supabaseServiceKey: get('SUPABASE_SERVICE_ROLE_KEY'),
      bucket: get('SUPABASE_BUCKET') ?? 'progress-photos',
    },
    tiktokPixelId: get('TIKTOK_PIXEL_ID'),
    authRateLimit: Number(get('AUTH_RATE_LIMIT') ?? 10),
  };
  if (production && cfg.stripe.secretKey?.startsWith('sk_live') && !cfg.stripe.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required when a live Stripe key is configured');
  }
  return cfg;
}
