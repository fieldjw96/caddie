ALTER TABLE "courses" DROP CONSTRAINT "courses_altitude_source_is_recorded";--> statement-breakpoint
ALTER TABLE "courses" DROP CONSTRAINT "courses_green_surface_source_is_recorded";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "altitude_source" "source";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "green_surface_source" "source";--> statement-breakpoint
-- Every row storing altitude or green surface before this migration read it from Wikipedia,
-- the only Source wikipedia-store.ts has ever written there; backfill says so explicitly
-- instead of leaving existing rows to fail the constraint below.
UPDATE "courses" SET "altitude_source" = 'wikipedia' WHERE "altitude" IS NOT NULL;--> statement-breakpoint
UPDATE "courses" SET "green_surface_source" = 'wikipedia' WHERE "green_surface" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_altitude_source_is_recorded" CHECK (("courses"."altitude" is null and "courses"."altitude_source" is null and "courses"."altitude_source_url" is null)
        or ("courses"."altitude" is not null and "courses"."altitude_source" is not null and "courses"."altitude_source" = 'wikipedia' and "courses"."altitude_source_url" is not null and btrim("courses"."altitude_source_url") <> ''));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_green_surface_source_is_recorded" CHECK (("courses"."green_surface" is null and "courses"."green_surface_source" is null and "courses"."green_surface_source_url" is null)
        or ("courses"."green_surface" is not null and btrim("courses"."green_surface") <> '' and "courses"."green_surface_source" is not null and "courses"."green_surface_source" = 'wikipedia' and "courses"."green_surface_source_url" is not null and btrim("courses"."green_surface_source_url") <> ''));