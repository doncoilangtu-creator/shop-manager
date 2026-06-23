-- ============================================================================
-- Sample seed data — run after 0001_init.sql
-- Safe to run multiple times thanks to on conflict do nothing.
-- ============================================================================

-- Categories
insert into public.categories (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'PC',          'pc'),
  ('22222222-2222-2222-2222-222222222222', 'Laptop',      'laptop'),
  ('33333333-3333-3333-3333-333333333333', 'Camera',      'camera'),
  ('44444444-4444-4444-4444-444444444444', 'Máy in',      'may-in'),
  ('55555555-5555-5555-5555-555555555555', 'Mực in',      'muc-in'),
  ('66666666-6666-6666-6666-666666666666', 'Thiết bị mạng','thiet-bi-mang'),
  ('77777777-7777-7777-7777-777777777777', 'Phụ kiện',    'phu-kien')
on conflict (id) do nothing;

-- A couple of demo customers (retail + business)
insert into public.customers (id, type, name, phone, email, address, tax_code, contact_person, debt_limit, tags) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'retail', 'Nguyễn Văn A', '0901234567', 'a@example.com',
   '12 Lê Lợi, Q1, TP.HCM', null, null, 0, array['vip']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'business', 'Công ty TNHH ABC', '02812345678', 'contact@abc.vn',
   '99 Nguyễn Huệ, Q1, TP.HCM', '0312345678',
   'Trần B', 50000000, array['doanh-nghiep'])
on conflict (id) do nothing;

-- A demo supplier
insert into public.suppliers (id, name, tax_code, phone, contact_person) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Công ty Phân phối XYZ', '0398765432', '02898765432', 'Lê C')
on conflict (id) do nothing;

-- A couple of demo products
insert into public.products (sku, name, category_id, brand, model, unit, cost_price, sell_price, stock_qty, min_stock, warranty_months) values
  ('PC-DELL-001', 'PC Dell Optiplex 7090',
   '11111111-1111-1111-1111-111111111111', 'Dell', 'Optiplex 7090',
   'bộ', 12000000, 15500000, 5, 2, 36),
  ('LT-ASUS-002', 'Laptop ASUS ExpertBook B9',
   '22222222-2222-2222-2222-222222222222', 'ASUS', 'B9400',
   'cái', 22000000, 26900000, 3, 2, 24),
  ('CAM-HIK-003', 'Camera Hikvision DS-2CD2143G2',
   '33333333-3333-3333-3333-333333333333', 'Hikvision', 'DS-2CD2143G2',
   'cái', 1800000, 2350000, 12, 5, 24)
on conflict (sku) do nothing;
