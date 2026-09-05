import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RESEARCH_BUSINESS_SETTINGS } from '@ara/shared';
import { createAdminSession } from '../../../lib/server/admin-session';
import { GET, POST } from './route';

const repositoryMocks = vi.hoisted(() => {
  class ResearchSettingsRepositoryError extends Error {
    constructor() {
      super('settings unavailable');
      this.name = 'ResearchSettingsRepositoryError';
    }
  }

  return {
    ResearchSettingsRepositoryError,
    read: vi.fn(),
    save: vi.fn()
  };
});

const {
  ResearchSettingsRepositoryError,
  read,
  save
} = repositoryMocks;

vi.mock('../../../lib/server/admin-session-store', () => ({
  isAdminSessionActive: async () => true
}));

vi.mock('../../../lib/server/database', () => ({
  getServerDatabaseContext: () => ({ client: {} }),
  ServerConfigurationError: class ServerConfigurationError extends Error {}
}));

vi.mock('@ara/db', () => ({
  createResearchSettingsRepository: () => ({
    read: repositoryMocks.read,
    save: repositoryMocks.save
  }),
  ResearchSettingsRepositoryError: repositoryMocks.ResearchSettingsRepositoryError
}));

const sessionKey = Buffer.alloc(32, 6);
const originalSigningKey = process.env.APP_SESSION_SIGNING_KEY_B64;

function authenticatedHeaders(csrf = true): HeadersInit {
  const issued = createAdminSession(sessionKey);
  const token = csrf ? issued.csrfToken : 'invalid-csrf-token';
  return {
    cookie: `ara_admin_session=${encodeURIComponent(issued.token)}; ara_csrf=${encodeURIComponent(issued.csrfToken)}`,
    origin: 'https://app.example.test',
    host: 'app.example.test',
    'x-csrf-token': token,
    'content-type': 'application/json'
  };
}

function settingsRequest(
  method: 'GET' | 'POST',
  headers: HeadersInit = {},
  body?: unknown
): Request {
  const init: RequestInit = {
    method,
    headers
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('https://app.example.test/api/research-settings', init);
}

describe('research settings route', () => {
  beforeEach(() => {
    process.env.APP_SESSION_SIGNING_KEY_B64 = sessionKey.toString('base64');
    read.mockReset();
    save.mockReset();
    read.mockResolvedValue({ ...DEFAULT_RESEARCH_BUSINESS_SETTINGS });
    save.mockResolvedValue({ ...DEFAULT_RESEARCH_BUSINESS_SETTINGS });
  });

  afterEach(() => {
    if (originalSigningKey === undefined) delete process.env.APP_SESSION_SIGNING_KEY_B64;
    else process.env.APP_SESSION_SIGNING_KEY_B64 = originalSigningKey;
  });

  it('rejects an unauthenticated settings read without repository access', async () => {
    const request = settingsRequest('GET');
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('reads settings without a GET side effect', async () => {
    const request = settingsRequest('GET', authenticatedHeaders());
    const response = await GET(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ settings: DEFAULT_RESEARCH_BUSINESS_SETTINGS });
    expect(read).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an invalid CSRF token before saving commercial settings', async () => {
    const request = settingsRequest('POST', authenticatedHeaders(false), DEFAULT_RESEARCH_BUSINESS_SETTINGS);
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects incomplete, invalid, or extra commercial settings before saving', async () => {
    const incomplete = { launchBudgetUsd: 3000, minimumPreAdMarginPct: 35, minimumPostAdMarginPct: 35 };
    const extra = { ...DEFAULT_RESEARCH_BUSINESS_SETTINGS, candidateMinimumRoiPct: 0 };
    const incompleteResponse = await POST(settingsRequest('POST', authenticatedHeaders(), incomplete));
    const extraResponse = await POST(settingsRequest('POST', authenticatedHeaders(), extra));
    expect(incompleteResponse.status).toBe(400);
    expect(extraResponse.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an oversized settings body before saving', async () => {
    const oversized = { ...DEFAULT_RESEARCH_BUSINESS_SETTINGS, ignored: 'x'.repeat(70_000) };
    const response = await POST(settingsRequest('POST', authenticatedHeaders(), oversized));
    expect(response.status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  it('returns storage failures as a generic unavailable response', async () => {
    read.mockRejectedValueOnce(new ResearchSettingsRepositoryError());
    save.mockRejectedValueOnce(new ResearchSettingsRepositoryError());
    const readResponse = await GET(settingsRequest('GET', authenticatedHeaders()));
    const writeResponse = await POST(settingsRequest('POST', authenticatedHeaders(), DEFAULT_RESEARCH_BUSINESS_SETTINGS));
    expect(readResponse.status).toBe(503);
    expect(writeResponse.status).toBe(503);
    await expect(readResponse.json()).resolves.toEqual({ error: 'research_settings_unavailable' });
  });

  it('saves exactly the parsed four-field commercial settings', async () => {
    const settings = {
      launchBudgetUsd: 4500,
      minimumPreAdMarginPct: 40,
      minimumPostAdMarginPct: 30,
      minimumRoiPct: 175
    };
    save.mockResolvedValueOnce(settings);
    const response = await POST(settingsRequest('POST', authenticatedHeaders(), settings));
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(settings);
    await expect(response.json()).resolves.toEqual({ settings });
  });
});
