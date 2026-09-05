alter table public.app_settings
  add column launch_budget_usd numeric not null default 3000,
  add column minimum_pre_ad_margin_pct numeric not null default 35,
  add column minimum_post_ad_margin_pct numeric not null default 35,
  add column minimum_roi_pct numeric not null default 150,
  add constraint app_settings_launch_budget_usd_finite_positive
    check (
      launch_budget_usd > 0
      and launch_budget_usd not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ),
  add constraint app_settings_minimum_pre_ad_margin_pct_valid
    check (
      minimum_pre_ad_margin_pct between 0 and 100
      and minimum_pre_ad_margin_pct not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ),
  add constraint app_settings_minimum_post_ad_margin_pct_valid
    check (
      minimum_post_ad_margin_pct between 0 and 100
      and minimum_post_ad_margin_pct not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ),
  add constraint app_settings_minimum_roi_pct_finite_nonnegative
    check (
      minimum_roi_pct >= 0
      and minimum_roi_pct not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    );

insert into public.app_settings (id) values (true) on conflict (id) do nothing;
