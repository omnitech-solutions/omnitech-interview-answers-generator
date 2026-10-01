ALTER TABLE platform.user_preferences
  ADD COLUMN IF NOT EXISTS ai_profile_id text;
