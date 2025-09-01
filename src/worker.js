export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER   = "X-shopifyEdgee-Auth";
    const EDGE_PROXY_URL    = "https://fixcheckedprj.edgee.app";  // Edgee origin
    const SHOPIFY_HOSTNAME  = "shops.myshopify.com";              // Shopify CNAME
    const PUBLIC_HOSTNAME   = "checkout.testtheedgefun.com";      // your domain

    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // ===== 0) Buffer the body once so we can safely resend across redirects =====
    const hasBody = !["GET","HEAD"].includes(method);
    const bodyBuf = hasBody ? await request.arrayBuffer() : null;

    // Copy/sanitize headers once
    const baseHeaders = sanitizeRequestHeaders(request.headers);

    // If you still want to bypass certain Shopify endpoints, list them here.
    const BYPASS_PREFIXES = [
      // "/.well-known/shopify/monorail/",
    ];
    const isBypassed =
      BYPASS_PREFIXES.some(p => url.pathname.startsWith(p));

    const isSensitive =
      url.pathname.startsWith("/cart") ||
      url.pathname.startsWith("/checkout") ||
      url.pathname.startsWith("/account");

    // Helper to build a Request from buffered body and headers
    const makeReq = (targetURL, overrideHeaders) => {
      const h = new Headers(overrideHeaders || baseHeaders);
      const init = {
        method,
        headers: h,
        redirect: "manual",
        body: hasBody && bodyBuf ? bodyBuf.slice(0) : undefined,
      };
      return new Request(targetURL.toString(), init);
    };

    // === 1) If the required header is already present → go straight to Shopify ===
    if (baseHeaders.has(REQUIRED_HEADER)) {
      // Build a URL that uses your public host in the URL bar.
      const shopURL = new URL(url.pathname + url.search, `https://${PUBLIC_HOSTNAME}`);

      // (Optional) If you were previously setting Host explicitly, do it here.
      // Note: Cloudflare may ignore/override Host; usually better to omit it.
      const h = new Headers(baseHeaders);
      h.set("Host", PUBLIC_HOSTNAME);

      const reqToShopify = makeReq(shopURL, h);

      return fetchWithRedirects(
        reqToShopify,
        // Per-hop fetch options (you can tweak cf settings here)
        (hopURL) => ({
          redirect: "manual",
          cf: {
            resolveOverride: SHOPIFY_HOSTNAME,
            cacheTtl: isSensitive ? 0 : undefined,
            cacheEverything: false,
          },
        }),
        { cacheNoStore: isSensitive }
      );
    }

    // === 2) If host is checkout.* and header is NOT present → route via Edgee ===
    if (url.hostname === PUBLIC_HOSTNAME && !isBypassed) {
      const edgeeURL = new URL(url.pathname + url.search, EDGE_PROXY_URL);

      const h2 = new Headers(baseHeaders);
      h2.set("X-From-Cloudflare-Worker", "1");

      const reqToEdgee = makeReq(edgeeURL, h2);

      return fetchWithRedirects(
        reqToEdgee,
        () => ({ redirect: "manual" }),
        { cacheNoStore: isSensitive }
      ,  // label response
        { "cf-worker-dest": "edgee(all-same-origin)" }
      );
    }

    // === 3) Fallback: direct to Shopify (rare on this route) ===
    {
      const shopURL = new URL(url.pathname + url.search, `https://${PUBLIC_HOSTNAME}`);

      const h = new Headers(baseHeaders);
      h.set("Host", PUBLIC_HOSTNAME);

      const reqToShopify = makeReq(shopURL, h);

      return fetchWithRedirects(
        reqToShopify,
        () => ({
          redirect: "manual",
          cf: {
            resolveOverride: SHOPIFY_HOSTNAME,
            cacheTtl: isSensitive ? 0 : undefined,
            cacheEverything: false,
          },
        }),
        { cacheNoStore: isSensitive },
        { "cf-worker-dest": "shopify(fallback)" }
      );
    }
  },
};

/* ======================= Helpers ======================= */

const MAX_REDIRECTS = 10;

/**
 * Manual redirect handling with a buffered body.
 * - 303 → pass to client (browser will switch to GET).
 * - 301/302 → pass to client (safer for forms). You can change this if needed.
 * - 307/308 → preserve method/body and re-send buffered body to the next hop.
 */
async function fetchWithRedirects(initialRequest, makePerHopOptions, opts = {}, extraRespHeaders = {}) {
  const { cacheNoStore = false } = opts;

  let currentURL = new URL(initialRequest.url);
  let currentRequest = initialRequest;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const resp = await fetch(currentRequest, makePerHopOptions(currentURL));

    if (!isRedirect(resp.status)) {
      return finalizeResponse(resp, cacheNoStore, extraRespHeaders);
    }

    const loc = resp.headers.get("Location");
    if (!loc) {
      return finalizeResponse(resp, cacheNoStore, extraRespHeaders);
    }

    const nextURL = new URL(loc, currentURL);

    // Status-specific handling:
    if (resp.status === 303) {
      // Best: let browser handle 303, avoids body replay semantics here.
      return passThroughRedirect(resp, nextURL, cacheNoStore, extraRespHeaders);
    }

    if (resp.status === 301 || resp.status === 302) {
      // Safer for POST forms: let the browser handle it
      return passThroughRedirect(resp, nextURL, cacheNoStore, extraRespHeaders);
    }

    // 307/308 → re-send same method/body; build a new Request with same init
    currentURL = nextURL;
    currentRequest = new Request(currentURL.toString(), {
      method: initialRequest.method,
      headers: initialRequest.headers,
      body: await cloneBodyIfAny(initialRequest),
      redirect: "manual",
    });
  }

  return new Response("Too many redirects", { status: 508 });
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function cloneBodyIfAny(req) {
  if (req.bodyUsed) {
    // We constructed initialRequest ourselves with an ArrayBuffer each time,
    // so this path should not occur. Kept for safety.
    return null;
  }
  // If there was a body, it was supplied as an ArrayBuffer; request.clone() isn’t needed
  // because we always provide a fresh ArrayBuffer slice in makeReq.
  return req.method === "GET" || req.method === "HEAD" ? undefined : req.arrayBuffer();
}

function sanitizeRequestHeaders(inHeaders) {
  const out = new Headers(inHeaders);
  const hopByHop = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ];
  for (const h of hopByHop) out.delete(h);
  out.delete("content-length");
  out.delete("host");
  return out;
}

function sanitizeResponseHeaders(inHeaders) {
  const out = new Headers(inHeaders);
  const hopByHop = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ];
  for (const h of hopByHop) out.delete(h);
  return out;
}

function finalizeResponse(upstreamResp, noStore, extra = {}) {
  const headers = sanitizeResponseHeaders(upstreamResp.headers);
  if (noStore) headers.set("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers,
  });
}

function passThroughRedirect(upstreamResp, absoluteNextURL, noStore, extra = {}) {
  const headers = sanitizeResponseHeaders(upstreamResp.headers);
  headers.set("Location", absoluteNextURL.toString());
  if (noStore) headers.set("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(null, { status: upstreamResp.status, headers });
}
