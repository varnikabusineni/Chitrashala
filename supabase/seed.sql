-- =====================================================================
-- seed.sql — GENERATED from seed/seed.json by scripts/build-seed-sql.js
-- Safe to run many times (idempotent). Run AFTER the 4 migrations.
-- =====================================================================
begin;

-- Studio settings: currency and mural rate (INR 150 / sq ft)
insert into public.studio_settings (id, currency, mural_rate_per_sqft)
values (true, 'INR', 150)
on conflict (id) do update set currency = excluded.currency,
  mural_rate_per_sqft = excluded.mural_rate_per_sqft;

-- 12 paintings (DO NOTHING: never overwrite live status)
insert into public.paintings (id, title, artist, description, price, image_url, status) values
  ('p-001', 'Madhubani Peacock Garden', 'Meera Kumari', 'Madhubani style. Natural pigments on handmade paper, 45 x 60 cm.', 6500, 'images/p-001.jpg', 'available'),
  ('p-002', 'Warli Village Scene (Small)', 'Anil Gavit', 'Warli style. White rice-paste motifs on a brown canvas board, 25 x 25 cm.', 1800, 'images/p-002.jpg', 'available'),
  ('p-003', 'Tanjore Lakshmi with Gold Leaf', 'Revathi Iyer', 'Tanjore style. Gold foil and glass stones on a wooden board, 60 x 75 cm.', 24500, 'images/p-003.jpg', 'available'),
  ('p-004', 'Pattachitra Dashavatara Panel', 'Bikram Swain', 'Pattachitra style. Natural colours on tussar cloth, 40 x 120 cm. Ten avatars of Vishnu in a long panel.', 12000, 'images/p-004.jpg', 'sold'),
  ('p-005', 'Kalamkari Tree of Life', 'Padma Reddy', 'Kalamkari style. Hand-painted vegetable dyes on cotton, 60 x 90 cm.', 9200, 'images/p-005.jpg', 'available'),
  ('p-006', 'Gond Forest Spirits', 'Mohan Markam', 'Gond style. Acrylic on canvas, 50 x 70 cm. Birds, deer and trees filled with fine dots and lines.', 7300, 'images/p-006.jpg', 'available'),
  ('p-007', 'Cheriyal Panel: Bonalu Procession', 'Ramesh Naidu', 'Cheriyal style from Telangana. Poster colours on cloth, 45 x 90 cm.', 6800, 'images/p-007.jpg', 'available'),
  ('p-008', 'Rajasthani Miniature: Courtyard at Dusk', 'Kishan Singh Rathore', 'Miniature style. Mineral colours on paper, 30 x 40 cm.', 15500, 'images/p-008.jpg', 'available'),
  ('p-009', 'Pichwai Lotus Pond', 'Gopal Sharma', 'Pichwai style. Pigments and gold on cloth, 60 x 90 cm.', 18000, 'images/p-009.jpg', 'sold'),
  ('p-010', 'Nirmal-Style Court Musicians', 'Lakshmi Prasad', 'Nirmal style from Telangana. Gold-toned colours on wood, 30 x 45 cm.', 5400, 'images/p-010.jpg', 'available'),
  ('p-011', 'Kathakali Face in Kerala Mural Style', 'Sreeja Nair', 'Kerala mural style. Natural pigments on a wooden panel, 40 x 50 cm.', 11000, 'images/p-011.jpg', 'available'),
  ('p-012', 'Evening Prayers at the Ghats of Varanasi, with Floating Diyas on the Ganga and Temple Bells in the Distance', 'Arjun Mishra', 'Oil on canvas, 90 x 120 cm. A wide evening scene of the Ganga aarti, with rows of floating diyas, boats near the steps, and temple spires fading into the haze. This long description is here on purpose, so that your layout is tested with a lot of text.', 25000, 'images/p-012.jpg', 'available')
on conflict (id) do nothing;

-- 5 pottery items
insert into public.pottery_items (id, name) values
  ('i-01', 'Kulhad (clay cup)'),
  ('i-02', 'Surahi (water jug)'),
  ('i-03', 'Matka (water pot)'),
  ('i-04', 'Diya set'),
  ('i-05', 'Gamla (planter)')
on conflict (id) do update set name = excluded.name;

-- 6 glazes
insert into public.glazes (id, name) values
  ('g-01', 'Kumkum Red'),
  ('g-02', 'Haldi Yellow'),
  ('g-03', 'Mehendi Green'),
  ('g-04', 'Indigo Blue'),
  ('g-05', 'Sandalwood Beige'),
  ('g-06', 'Charcoal Black')
on conflict (id) do update set name = excluded.name;

commit;

-- Studio account (studio@artstudio.in): created through Supabase Auth,
-- NOT here. See README section 'Provision the studio admin account'.
