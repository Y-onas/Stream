BEGIN;
ALTER TABLE hh_videos ADD COLUMN "publicId" uuid NOT NULL DEFAULT gen_random_uuid(), ADD COLUMN "accessType" text NOT NULL DEFAULT 'VIP';
CREATE UNIQUE INDEX hh_videos_public_id ON hh_videos("publicId");
ALTER TABLE hh_videos ADD CONSTRAINT hh_videos_access_type CHECK ("accessType" IN ('VIP','FREE'));
ALTER TABLE hh_playback_sessions ADD COLUMN "accessType" text, ADD COLUMN "accountSessionId" uuid, ADD COLUMN "authorizedUntil" timestamptz(3), ADD COLUMN "revokedAt" timestamptz(3);
ALTER TABLE hh_playback_sessions ADD CONSTRAINT hh_playback_access_type CHECK ("accessType" IS NULL OR "accessType" IN ('VIP','FREE'));
ALTER TABLE hh_video_views ADD COLUMN "accessType" text;
ALTER TABLE hh_video_views ADD CONSTRAINT hh_view_access_type CHECK ("accessType" IS NULL OR "accessType" IN ('VIP','FREE'));
CREATE INDEX hh_video_views_access_date ON hh_video_views("accessType","qualifiedAt");
ALTER TABLE hh_subscription_requests ADD COLUMN "intendedVideoPublicId" uuid;
-- Existing counts remain historical/unknown; they were not authorized as VIP.
COMMIT;
