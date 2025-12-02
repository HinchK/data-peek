CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"provider" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "instance_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_webhook_events_event_id" ON "webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_provider" ON "webhook_events" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_event_name" ON "webhook_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_processed" ON "webhook_events" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "idx_activations_instance" ON "activations" USING btree ("instance_id");--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_instance_id_unique" UNIQUE("instance_id");