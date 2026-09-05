import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ResearchBusinessSettingsSchema,
  type ResearchBusinessSettings
} from '@ara/shared';
import type { Database } from './types';

type ResearchSettingsRow = Pick<
  Database['public']['Tables']['app_settings']['Row'],
  | 'launch_budget_usd'
  | 'minimum_pre_ad_margin_pct'
  | 'minimum_post_ad_margin_pct'
  | 'minimum_roi_pct'
>;

export class ResearchSettingsRepositoryError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'ResearchSettingsRepositoryError';
  }
}

function settingsFromRow(row: ResearchSettingsRow): ResearchBusinessSettings {
  const parsed = ResearchBusinessSettingsSchema.safeParse({
    launchBudgetUsd: row.launch_budget_usd,
    minimumPreAdMarginPct: row.minimum_pre_ad_margin_pct,
    minimumPostAdMarginPct: row.minimum_post_ad_margin_pct,
    minimumRoiPct: row.minimum_roi_pct
  });
  if (!parsed.success) {
    throw new ResearchSettingsRepositoryError('load research settings');
  }
  return parsed.data;
}

function rowFromSettings(settings: ResearchBusinessSettings) {
  return {
    launch_budget_usd: settings.launchBudgetUsd,
    minimum_pre_ad_margin_pct: settings.minimumPreAdMarginPct,
    minimum_post_ad_margin_pct: settings.minimumPostAdMarginPct,
    minimum_roi_pct: settings.minimumRoiPct
  };
}

const settingsColumns = 'launch_budget_usd,minimum_pre_ad_margin_pct,minimum_post_ad_margin_pct,minimum_roi_pct';

export interface ResearchSettingsRepository {
  read(): Promise<ResearchBusinessSettings>;
  save(settings: ResearchBusinessSettings): Promise<ResearchBusinessSettings>;
}

export function createResearchSettingsRepository(
  client: Pick<SupabaseClient<Database>, 'from'>
): ResearchSettingsRepository {
  return {
    async read() {
      const { data, error } = await client
        .from('app_settings')
        .select(settingsColumns)
        .eq('id', true)
        .maybeSingle();
      if (error || data === null) {
        throw new ResearchSettingsRepositoryError('load research settings', error);
      }
      return settingsFromRow(data);
    },

    async save(settings) {
      const parsed = ResearchBusinessSettingsSchema.safeParse(settings);
      if (!parsed.success) {
        throw new ResearchSettingsRepositoryError('save research settings');
      }
      const { data, error } = await client
        .from('app_settings')
        .update(rowFromSettings(parsed.data))
        .eq('id', true)
        .select(settingsColumns)
        .maybeSingle();
      if (error || data === null) {
        throw new ResearchSettingsRepositoryError('save research settings', error);
      }
      return settingsFromRow(data);
    }
  };
}
