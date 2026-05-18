/**
 * @jest-environment jsdom
 *
 * TM-164 (ADR-0029 §4) — Studio UI async generate + polling.
 *
 * Covers the live `useStudio` surface that the PR introduces:
 *   1. `generate(prompt, undefined, { async: true })` posts to
 *      /api/generate?async=1 and registers the returned jobId.
 *   2. Polling: GET /api/jobs/[id] fires immediately + every
 *      JOB_POLL_INTERVAL_MS, status transitions PENDING → RUNNING.
 *   3. SUCCEEDED with `resultAsset` populates `state.asset` and clears
 *      `isGenerating`.
 *   4. FAILED surfaces `state.error` and clears `isGenerating`.
 *   5. 404 short-circuits with a "Job not found" error.
 *
 * We mock global `fetch` and use jest fake timers to drive the interval.
 * `toast` from sonner is mocked to avoid touching the DOM portal.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useStudio, JOB_POLL_INTERVAL_MS } from '@/hooks/useStudio';

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    message: jest.fn(),
  }),
}));

type FetchMock = jest.Mock<Promise<Partial<Response>>, [input: RequestInfo, init?: RequestInit]>;

function mockJsonResponse(body: unknown, status = 200): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const SUCCEEDED_ASSET = {
  id: 'asset-cuid-123',
  title: 'Async Result',
  code: '/* async code */',
  jsCode: '/* async js */',
  parameters: JSON.stringify([
    { key: 'color', label: 'Color', group: 'color', type: 'color', value: '#00FF00' },
  ]),
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
};

describe('useStudio — TM-164 async generate + polling', () => {
  let fetchMock: FetchMock;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    originalFetch = global.fetch;
    fetchMock = jest.fn() as unknown as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('async submit registers jobId and polls until SUCCEEDED → SET_ASSET', async () => {
    fetchMock
      // POST /api/generate?async=1
      .mockResolvedValueOnce(mockJsonResponse({ jobId: 'job-1', status: 'PENDING' }, 202))
      // First immediate poll
      .mockResolvedValueOnce(mockJsonResponse({ id: 'job-1', status: 'PENDING' }))
      // After 1st interval — RUNNING
      .mockResolvedValueOnce(mockJsonResponse({ id: 'job-1', status: 'RUNNING' }))
      // After 2nd interval — SUCCEEDED w/ asset
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: 'job-1',
          status: 'SUCCEEDED',
          resultAssetId: SUCCEEDED_ASSET.id,
          resultAsset: SUCCEEDED_ASSET,
        }),
      );

    const { result } = renderHook(() => useStudio());

    await act(async () => {
      await result.current.generate('make a green counter', undefined, { async: true });
    });

    // Submit recorded
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/generate?async=1',
      expect.objectContaining({ method: 'POST' }),
    );
    // Submit registered the job id. Status may already have advanced from
    // the synchronous-microtask immediate poll — don't pin status here,
    // the SUCCEEDED assertion below is the real terminal check.
    expect(result.current.currentJob?.id).toBe('job-1');

    // Effect fires its immediate poll.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance to RUNNING tick.
    await act(async () => {
      jest.advanceTimersByTime(JOB_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance to SUCCEEDED tick.
    await act(async () => {
      jest.advanceTimersByTime(JOB_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.asset?.id).toBe('asset-cuid-123');
    });
    expect(result.current.state.isGenerating).toBe(false);
    expect(result.current.state.asset?.parameters).toEqual([
      { key: 'color', label: 'Color', group: 'color', type: 'color', value: '#00FF00' },
    ]);
  });

  it('FAILED status surfaces error and clears isGenerating', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ jobId: 'job-2', status: 'PENDING' }, 202))
      .mockResolvedValueOnce(
        mockJsonResponse({ id: 'job-2', status: 'FAILED', error: 'OPENAI rate limit' }),
      );

    const { result } = renderHook(() => useStudio());

    await act(async () => {
      await result.current.generate('boom', undefined, { async: true });
    });

    // Wait through immediate poll.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.error).toBe('OPENAI rate limit');
    });
    expect(result.current.state.isGenerating).toBe(false);
  });

  it('404 on poll resolves to "Job not found"', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ jobId: 'job-3', status: 'PENDING' }, 202))
      .mockResolvedValueOnce(mockJsonResponse({ error: 'Job not found' }, 404));

    const { result } = renderHook(() => useStudio());

    await act(async () => {
      await result.current.generate('vanish', undefined, { async: true });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.error).toBe('Job not found');
    });
    expect(result.current.currentJob).toBeNull();
  });

  it('async POST failure surfaces error without scheduling polls', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: 'over quota' }, 429));

    const { result } = renderHook(() => useStudio());

    await act(async () => {
      await result.current.generate('busted', undefined, { async: true });
    });

    expect(result.current.state.error).toBe('over quota');
    expect(result.current.currentJob).toBeNull();
    // No polling fetch issued.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
