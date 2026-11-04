ALTER TYPE "public"."source" ADD VALUE 'openstreetmap';--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'copernicus';--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'declared';--> statement-breakpoint
ALTER TABLE "courses" DROP CONSTRAINT "courses_altitude_source_is_recorded";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes_source" "source";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes_source_url" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "coordinates_source" "source";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "coordinates_source_url" text;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_holes_source_is_recorded" CHECK (("courses"."holes_source" is null and "courses"."holes_source_url" is null)
        or ("courses"."holes" is not null and "courses"."holes_source" is not null and "courses"."holes_source"::text in ('openstreetmap', 'declared') and "courses"."holes_source_url" is not null and btrim("courses"."holes_source_url") <> ''));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_coordinates_source_is_recorded" CHECK (("courses"."latitude" is null and "courses"."longitude" is null and "courses"."coordinates_source" is null and "courses"."coordinates_source_url" is null)
        or ("courses"."latitude" between -90 and 90 and "courses"."longitude" between -180 and 180 and "courses"."coordinates_source" is not null and "courses"."coordinates_source"::text in ('opengolfapi', 'openstreetmap') and "courses"."coordinates_source_url" is not null and btrim("courses"."coordinates_source_url") <> ''));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_altitude_source_is_recorded" CHECK (("courses"."altitude" is null and "courses"."altitude_source" is null and "courses"."altitude_source_url" is null)
        or ("courses"."altitude" is not null and "courses"."altitude_source" is not null and "courses"."altitude_source"::text in ('wikipedia', 'copernicus') and "courses"."altitude_source_url" is not null and btrim("courses"."altitude_source_url") <> ''));