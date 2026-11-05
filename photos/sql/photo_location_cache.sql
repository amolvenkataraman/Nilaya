-- public.photos_photo_location_cache source

CREATE MATERIALIZED VIEW public.photos_photo_location_cache
TABLESPACE pg_default
AS SELECT photos_photo.album_id,
    round(photos_photo.latitude::numeric, 5) AS lat,
    round(photos_photo.longitude::numeric, 5) AS lng,
    photos_photo.altitude > 1000::double precision AS on_plane,
    EXTRACT(year FROM photos_photo.date_taken) AS dt_year,
    count(*) AS cnt
   FROM photos_photo
  WHERE NOT photos_photo.hidden AND photos_photo.latitude IS NOT NULL AND photos_photo.longitude IS NOT NULL
  GROUP BY photos_photo.album_id, (round(photos_photo.latitude::numeric, 5)), (round(photos_photo.longitude::numeric, 5)), (EXTRACT(year FROM photos_photo.date_taken)), (photos_photo.altitude > 1000::double precision)
 HAVING round(photos_photo.latitude::numeric, 5) <> 0::numeric OR round(photos_photo.longitude::numeric, 5) <> 0::numeric
WITH DATA;
