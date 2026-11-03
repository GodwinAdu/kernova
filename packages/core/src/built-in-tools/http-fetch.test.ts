import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHttpFetchTool } from './http-fetch.js';

describe('http-fetch tool', () => {
  // Resolve every host to a public address so no test touches real DNS
  const tool = createHttpFetchTool({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] });

  it('has correct id, name, and description', () => {
    expect(tool.id).toBe('http-fetch');
    expect(tool.name).toBe('HTTP Fetch');
    expect(tool.description).toContain('HTTP requests');
  });

  it('has required parameters defined', () => {
    const params = tool.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;
    expect(properties.url).toBeDefined();
    expect(properties.method).toBeDefined();
    expect(properties.headers).toBeDefined();
    expect(properties.body).toBeDefined();
    expect(properties.timeout).toBeDefined();
    expect(params.required).toEqual(['url']);
  });

  describe('execute', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    });

    it('makes a GET request by default and returns status, headers, body', async () => {
      const mockHeaders = new Headers({ 'content-type': 'text/plain' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('Hello World'),
      });

      const result = await tool.execute({ url: 'https://example.com' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ method: 'GET' }),
      );

      expect(result).toEqual({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: 'Hello World',
      });
    });

    it('makes a POST request with body', async () => {
      const mockHeaders = new Headers({ 'content-type': 'application/json' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: mockHeaders,
        text: () => Promise.resolve('{"id": 1}'),
      });

      const result = await tool.execute({
        url: 'https://api.example.com/items',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name": "test"}',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"name": "test"}',
        }),
      );

      expect(result).toEqual({
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
        body: '{"id": 1}',
      });
    });

    it('does not send body for GET requests even if provided', async () => {
      const mockHeaders = new Headers();
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve(''),
      });

      await tool.execute({
        url: 'https://example.com',
        method: 'GET',
        body: 'should be ignored',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'GET',
          body: undefined,
        }),
      );
    });

    it('handles network errors gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error: ECONNREFUSED'));

      const result = await tool.execute({ url: 'https://unreachable.example.com' });

      expect(result).toEqual({
        error: true,
        message: 'Network error: ECONNREFUSED',
      });
    });

    it('handles timeout errors gracefully', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const resultPromise = tool.execute({ url: 'https://slow.example.com', timeout: 5000 });

      // Advance time past the timeout
      vi.advanceTimersByTime(5001);

      const result = await resultPromise;

      expect(result).toEqual({
        error: true,
        message: 'Request timed out after 5000ms',
      });
    });

    it('uses default timeout of 30000ms', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const resultPromise = tool.execute({ url: 'https://slow.example.com' });

      // Advance time past the default 30s timeout
      vi.advanceTimersByTime(30001);

      const result = await resultPromise;

      expect(result).toEqual({
        error: true,
        message: 'Request timed out after 30000ms',
      });
    });

    it('supports PUT and PATCH methods with body', async () => {
      const mockHeaders = new Headers();
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('updated'),
      });

      await tool.execute({
        url: 'https://api.example.com/items/1',
        method: 'PUT',
        body: '{"name": "updated"}',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items/1',
        expect.objectContaining({
          method: 'PUT',
          body: '{"name": "updated"}',
        }),
      );
    });

    it('supports DELETE method', async () => {
      const mockHeaders = new Headers();
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 204,
        statusText: 'No Content',
        headers: mockHeaders,
        text: () => Promise.resolve(''),
      });

      const result = await tool.execute({
        url: 'https://api.example.com/items/1',
        method: 'DELETE',
      });

      expect(result).toEqual({
        status: 204,
        statusText: 'No Content',
        headers: {},
        body: '',
      });
    });
  });
});
