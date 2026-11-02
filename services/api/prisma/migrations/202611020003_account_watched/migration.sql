BEGIN;
CREATE TABLE "hh_watched_videos" (
  "userId" UUID NOT NULL REFERENCES "hh_users"("id") ON DELETE CASCADE,
  "videoId" TEXT NOT NULL REFERENCES "hh_videos"("id") ON DELETE CASCADE,
  "firstWatchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastWatchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "videoId")
);
CREATE INDEX "hh_watched_videos_userId_lastWatchedAt_idx" ON "hh_watched_videos"("userId", "lastWatchedAt");
INSERT INTO "hh_watched_videos" ("userId", "videoId", "firstWatchedAt", "lastWatchedAt")
SELECT "userId", "videoId", MIN("qualifiedAt"), MAX("qualifiedAt")
FROM "hh_video_views" WHERE "userId" IS NOT NULL GROUP BY "userId", "videoId";
COMMIT;
