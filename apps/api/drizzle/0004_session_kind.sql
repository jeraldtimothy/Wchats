CREATE TYPE "public"."session_kind" AS ENUM('chat', 'ask');--> statement-breakpoint
DROP INDEX "chat_sessions_user_activity_idx";--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'chat' NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_sessions_user_activity_idx" ON "chat_sessions" USING btree ("user_id","kind","last_activity_at");