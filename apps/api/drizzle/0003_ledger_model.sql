ALTER TABLE "ledger_entries" ADD COLUMN "model_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: reply charges get their session's model.
UPDATE "ledger_entries" AS l SET "model_id" = s."model_id"
FROM "messages" AS m JOIN "chat_sessions" AS s ON s."id" = m."session_id"
WHERE l."message_id" = m."id" AND l."model_id" IS NULL;
