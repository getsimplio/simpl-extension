type Env = {
  ZEROX_API_KEY: string;
  SIMPLE_SWAP_FEE_RECIPIENT?: string;
  SIMPLE_SWAP_FEE_BPS?: string;
  ALLOWED_ORIGINS?: string;
};

const ZERO_X_BASE_URL = "https://api.0x.org";

const ALLOWED_PATHS = new Set([
  "/swap/allowance-holder/price",
  "/swap/allowance-holder/quote"
]);

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const requestHeaders =
    request.headers.get("access-control-request-headers") ??
    "content-type, 0x-version, 0x-api-key";

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const allowAny = allowedOrigins.includes("*");
  const allowOrigin = allowAny
    ? "*"
    : allowedOrigins.includes(origin)
      ? origin
      : "";

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": requestHeaders,
    "access-control-max-age": "86400"
  };
}

function assertOriginAllowed(request: Request, env: Env): Response | null {
  const origin = request.headers.get("origin");

  if (!origin) {
    return null;
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return null;
  }

  return jsonResponse(
    { error: "Origin is not allowed." },
    403,
    getCorsHeaders(request, env)
  );
}

function rateLimit(request: Request, env: Env): Response | null {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";

  const now = Date.now();
  const windowMs = 60_000;
  const limit = 120;

  const current = rateLimitBuckets.get(ip);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(ip, {
      count: 1,
      resetAt: now + windowMs
    });

    return null;
  }

  current.count += 1;

  if (current.count > limit) {
    return jsonResponse(
      { error: "Too many swap requests. Please try again later." },
      429,
      getCorsHeaders(request, env)
    );
  }

  return null;
}

function getFeeBps(env: Env): number {
  const parsed = Number(env.SIMPLE_SWAP_FEE_BPS ?? "50");

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(1000, Math.trunc(parsed));
}

function applyServerFee(searchParams: URLSearchParams, env: Env): void {
  const recipient = env.SIMPLE_SWAP_FEE_RECIPIENT?.trim();
  const bps = getFeeBps(env);

  searchParams.delete("swapFeeRecipient");
  searchParams.delete("swapFeeBps");
  searchParams.delete("swapFeeToken");

  if (!recipient || bps <= 0) {
    return;
  }

  const sellToken = searchParams.get("sellToken");
  const buyToken = searchParams.get("buyToken");

  searchParams.set("swapFeeRecipient", recipient);
  searchParams.set("swapFeeBps", String(bps));
  searchParams.set("swapFeeToken", sellToken ?? buyToken ?? "");
}

async function proxyZeroX(request: Request, env: Env): Promise<Response> {
  if (!env.ZEROX_API_KEY || env.ZEROX_API_KEY === "your_0x_api_key_here") {
    return jsonResponse(
      { error: "ZEROX_API_KEY is not configured." },
      500,
      getCorsHeaders(request, env)
    );
  }

  const originError = assertOriginAllowed(request, env);

  if (originError) {
    return originError;
  }

  const rateLimitError = rateLimit(request, env);

  if (rateLimitError) {
    return rateLimitError;
  }

  const inputUrl = new URL(request.url);

  if (!ALLOWED_PATHS.has(inputUrl.pathname)) {
    return jsonResponse(
      {
        error: "Unsupported endpoint.",
        allowedEndpoints: [...ALLOWED_PATHS]
      },
      404,
      getCorsHeaders(request, env)
    );
  }

  const targetUrl = new URL(`${ZERO_X_BASE_URL}${inputUrl.pathname}`);

  inputUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  applyServerFee(targetUrl.searchParams, env);

  const zeroXResponse = await fetch(targetUrl.toString(), {
    method: "GET",
    headers: {
      "0x-api-key": env.ZEROX_API_KEY,
      "0x-version": "v2"
    }
  });

  const responseHeaders = new Headers(zeroXResponse.headers);

  for (const [key, value] of Object.entries(getCorsHeaders(request, env))) {
    responseHeaders.set(key, value);
  }

  responseHeaders.set("cache-control", "no-store");

  return new Response(zeroXResponse.body, {
    status: zeroXResponse.status,
    statusText: zeroXResponse.statusText,
    headers: responseHeaders
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, env)
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { error: "Method not allowed." },
        405,
        getCorsHeaders(request, env)
      );
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: "simpl-zero-x-proxy"
        },
        200,
        getCorsHeaders(request, env)
      );
    }

    return proxyZeroX(request, env);
  }
};
