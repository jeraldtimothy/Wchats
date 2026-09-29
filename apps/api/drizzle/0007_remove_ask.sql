ALTER TABLE "profiles" ALTER COLUMN "allowed_frontends" SET DEFAULT '{chat}'::text[];--> statement-breakpoint
-- The Ask app was removed: drop it from every user's apps and move Ask defaults to Chat.
UPDATE "profiles" SET "allowed_frontends" = array_remove("allowed_frontends", 'ask') WHERE 'ask' = ANY("allowed_frontends");--> statement-breakpoint
UPDATE "profiles" SET "default_app" = 'chat' WHERE "default_app" = 'ask';
