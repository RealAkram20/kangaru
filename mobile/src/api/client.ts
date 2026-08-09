import { ApiError, NetworkError, type ValidationErrors } from './errors';

/**
 * The success envelope every endpoint returns (AGENTS.md API Standards).
 * `meta` is present on listings only.
 */
export type ApiEnvelope<TData, TMeta = unknown> = {
  success: true;
  message: string;
  data: TData;
  meta?: TMeta;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Serialised as JSON. Mutually exclusive with `form`. */
  body?: unknown;
  /** Sent as multipart/form-data — the transition endpoint's photo path. */
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  /** Milliseconds before the request is aborted and treated as an unknown outcome. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** How the client obtains the bearer token, and what it does when one is rejected. */
export type ApiClientConfig = {
  baseUrl: string;
  getToken: () => string | null;
  /** Called on any 401 so the session layer can clear a token that is now dead. */
  onUnauthenticated?: () => void;
};

/**
 * 15 seconds. Long enough for a photo upload to start on a weak upcountry
 * connection, short enough that a driver tapping Complete is not staring at a
 * spinner. The outbox owns what happens after: a timeout is an unknown
 * outcome, not a failure, and is reconciled rather than retried blind.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  async request<TData, TMeta = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiEnvelope<TData, TMeta>> {
    const response = await this.send(path, options);

    // 204 has no body to parse — the leave-request withdrawal is the only one
    // this app issues.
    if (response.status === 204) {
      return { success: true, message: '', data: undefined as TData };
    }

    const payload = await readJson(response);

    if (!response.ok) {
      throw toApiError(response, payload);
    }

    return payload as ApiEnvelope<TData, TMeta>;
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    const token = this.config.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }

    // Content-Type is set for JSON only. On multipart the runtime has to write
    // it itself so the boundary matches the body it generated.
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const body = options.form ?? (options.body === undefined ? null : JSON.stringify(options.body));

    let response: Response;

    try {
      response = await fetch(this.config.baseUrl + path + buildQuery(options.query), {
        method: options.method ?? 'GET',
        headers,
        // Omitted rather than set to undefined: `exactOptionalPropertyTypes`
        // treats those as different, and a GET with an explicit body key
        // fails on some runtimes.
        ...(body === null ? {} : { body }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new NetworkError('The request did not reach the server.', cause);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      this.config.onUnauthenticated?.();
    }

    return response;
  }
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) {
    return '';
  }

  const pairs = Object.entries(query).filter(([, value]) => value !== undefined);

  if (pairs.length === 0) {
    return '';
  }

  return '?' + pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Turns a refusal into an `ApiError` carrying its machine-readable `code`.
 *
 * The fallbacks matter more than the happy path. A 429 from the auth throttle
 * is rendered by the framework and carries no envelope at all
 * (`docs/api/openapi.yaml`, the `Throttled` response), and a proxy 502 carries
 * HTML. Both must still arrive here as something the outbox can classify, so
 * an absent `code` is synthesised from the status rather than left undefined —
 * a branch on `undefined` is the message-text branching AGENTS.md forbids,
 * wearing a different hat.
 */
function toApiError(response: Response, payload: unknown): ApiError {
  const envelope = (payload ?? {}) as {
    code?: unknown;
    message?: unknown;
    errors?: unknown;
  };

  const retryAfter = response.headers.get('Retry-After');

  return new ApiError({
    code: typeof envelope.code === 'string' ? envelope.code : codeForStatus(response.status),
    message:
      typeof envelope.message === 'string'
        ? envelope.message
        : 'Something went wrong. Please try again.',
    status: response.status,
    errors: (envelope.errors as ValidationErrors) ?? {},
    retryAfterSeconds: retryAfter === null ? null : Number.parseInt(retryAfter, 10) || null,
  });
}

function codeForStatus(status: number): string {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 422) return 'VALIDATION_FAILED';
  if (status === 429) return 'THROTTLED';

  return 'SERVER_ERROR';
}
