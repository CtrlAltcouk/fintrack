export class ApiError extends Error {
  constructor(message, { status = 0, code = 'request_failed' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function createApi(onUnauthorized) {
  let categories = [];
  let accounts = [];

  async function api(path, opts = {}) {
    const controller = new AbortController();
    const timeoutMs = opts.timeout ?? 15000;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
    }, timeoutMs);
    const externalSignal = opts.signal;
    const abortFromExternal = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else if (externalSignal) externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    };

    const hasBody = Object.prototype.hasOwnProperty.call(opts, 'body');
    const headers = {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    };
    const { body, timeout: _timeout, signal: _signal, ...fetchOptions } = opts;

    let response;
    try {
      response = await fetch('/api' + path, {
        ...fetchOptions,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      cleanup();
      if (timedOut) {
        throw new ApiError('The request timed out. Please try again.', { status: 408, code: 'timeout' });
      }
      if (controller.signal.aborted) {
        throw new ApiError('The request was cancelled.', { code: 'aborted' });
      }
      throw new ApiError('Unable to contact Outflow. Please try again.', { code: 'network_error' });
    }

    if (response.status === 204) {
      cleanup();
      if (!response.ok) throw new ApiError('The request could not be completed.', { status: response.status });
      return null;
    }

    let text;
    try {
      text = await response.text();
    } catch (_) {
      if (timedOut) {
        throw new ApiError('The request timed out. Please try again.', { status: 408, code: 'timeout' });
      }
      throw new ApiError('Outflow returned an incomplete response.', { status: response.status, code: 'invalid_response' });
    } finally {
      cleanup();
    }
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch (_) { payload = null; }
    }

    if (response.status === 401 && payload?.error === 'unauthenticated') onUnauthorized();

    if (!response.ok) {
      const serverMessage = typeof payload?.error === 'string' && payload.error.length <= 200
        ? payload.error
        : null;
      const message = response.status >= 500
        ? 'Outflow could not complete the request. Please try again.'
        : serverMessage ?? `Request failed (${response.status}).`;
      throw new ApiError(message, { status: response.status, code: payload?.code });
    }
    if (payload === null && text) {
      throw new ApiError('Outflow returned an invalid response.', { status: response.status, code: 'invalid_response' });
    }
    return payload;
  }

  async function getCategories() {
    if (!categories.length) categories = await api('/categories');
    return categories;
  }

  function invalidateCategories() { categories = []; }

  async function getAccounts() {
    if (!accounts.length) accounts = await api('/accounts');
    return accounts;
  }

  function invalidateAccounts() { accounts = []; }

  return { api, getCategories, invalidateCategories, getAccounts, invalidateAccounts };
}
