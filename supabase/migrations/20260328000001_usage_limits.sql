-- ─── usage_limits ────────────────────────────────────────────────────────────
-- Tracks per-user freemium usage (e.g. auto-assign calls).
-- user_id is the Clerk user ID (or EXPO_PUBLIC_USER_ID in dev bypass mode).

CREATE TABLE IF NOT EXISTS usage_limits (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     text        NOT NULL,
  account_id  text        NOT NULL,
  auto_assign_count int   NOT NULL DEFAULT 0 CHECK (auto_assign_count >= 0),
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT usage_limits_user_account_unique UNIQUE (user_id, account_id)
);

CREATE INDEX IF NOT EXISTS usage_limits_user_id_idx ON usage_limits (user_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION set_usage_limits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_usage_limits_updated_at ON usage_limits;
CREATE TRIGGER trg_usage_limits_updated_at
  BEFORE UPDATE ON usage_limits
  FOR EACH ROW EXECUTE FUNCTION set_usage_limits_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE usage_limits ENABLE ROW LEVEL SECURITY;

-- Anon key: read own record only
CREATE POLICY "anon_select_own_usage" ON usage_limits
  FOR SELECT TO anon
  USING (true);

-- Service role: full access (used by secure proxy)
CREATE POLICY "service_role_all_usage" ON usage_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
