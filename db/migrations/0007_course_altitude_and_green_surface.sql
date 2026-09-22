ALTER TABLE "courses" ADD COLUMN "altitude" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "altitude_source_url" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "green_surface" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "green_surface_source_url" text;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_altitude_source_is_recorded" CHECK (("courses"."altitude" is null and "courses"."altitude_source_url" is null)
        or ("courses"."altitude" is not null and "courses"."altitude_source_url" is not null and btrim("courses"."altitude_source_url") <> ''));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_green_surface_source_is_recorded" CHECK (("courses"."green_surface" is null and "courses"."green_surface_source_url" is null)
        or ("courses"."green_surface" is not null and btrim("courses"."green_surface") <> '' and "courses"."green_surface_source_url" is not null and btrim("courses"."green_surface_source_url") <> ''));