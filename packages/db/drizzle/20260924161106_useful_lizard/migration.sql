DROP INDEX "thread_owner_archived_idx";--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread" DROP COLUMN "archived_at";