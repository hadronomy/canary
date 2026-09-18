CREATE TYPE "public"."message_part_kind" AS ENUM('text', 'reasoning', 'tool-call', 'tool-result', 'artifact', 'error', 'status');--> statement-breakpoint
CREATE TYPE "public"."message_part_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_cache_counter" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_cache_list" (
	"key" text NOT NULL,
	"idx" integer NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_cache_list_key_idx_pk" PRIMARY KEY("key","idx")
);
--> statement-breakpoint
CREATE TABLE "message_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"run_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" "message_part_kind" NOT NULL,
	"status" "message_part_status" DEFAULT 'pending' NOT NULL,
	"tool_name" text,
	"content" text DEFAULT '' NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "input_message_id" uuid;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "message_part_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "message_part_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "message_part_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "message_part_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_part_run_seq_unique" ON "message_part" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "message_part_thread_seq_idx" ON "message_part" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "message_part_owner_thread_idx" ON "message_part" USING btree ("owner_id","thread_id");--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_input_message_id_message_id_fk" FOREIGN KEY ("input_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_event_run_seq_unique" ON "run_event" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "run_input_message_idx" ON "run" USING btree ("input_message_id");