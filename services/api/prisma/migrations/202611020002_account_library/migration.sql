BEGIN;
ALTER TABLE "hh_users" ADD COLUMN "displayName" VARCHAR(50);
CREATE TABLE "hh_video_likes" (
  "userId" UUID NOT NULL REFERENCES "hh_users"("id") ON DELETE CASCADE,
  "videoId" TEXT NOT NULL REFERENCES "hh_videos"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "videoId")
);
CREATE INDEX "hh_video_likes_userId_createdAt_idx" ON "hh_video_likes"("userId", "createdAt");
CREATE TABLE "hh_saved_videos" (
  "userId" UUID NOT NULL REFERENCES "hh_users"("id") ON DELETE CASCADE,
  "videoId" TEXT NOT NULL REFERENCES "hh_videos"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "videoId")
);
CREATE INDEX "hh_saved_videos_userId_createdAt_idx" ON "hh_saved_videos"("userId", "createdAt");
CREATE INDEX "hh_video_views_userId_videoId_idx" ON "hh_video_views"("userId", "videoId");
COMMIT;
