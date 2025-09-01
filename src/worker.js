// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER   = "X-shopifyEdgee-Auth";              // required header name
    const EDGE_PROXY_URL    = "https://fixcheckedprj.edgee.app";  // ✅ updated Edgee origin
    const SHOPIFY_HOSTNAME  = "shops.myshopify.com";              // Shopify CNAME
    const PUBLIC_HOSTNAME   = "checkout.testtheedgefun.com";      // your custom domain

    // Store secret value in Worker env: `wrangler secret put EDGE_AUTH_VALUE`
    const REQUIRED_HEADER_VALUE = env.EDGE_AUTH_VALUE || "1";

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Dynamic paths: never cache
    const isSensitive =
      url.pathname.startsWith("/cart") ||
      url.pathname.startsWith("/checkout") ||
      url.pathname.startsWith("/account");

    // Methods that should go straight to Shopify (skip Edgee)
    const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method);

    const fwdHeaders = new Headers(request.headers);
    const isToEdgee = url.hostname === new URL(EDGE_PROXY_URL).hostname;

    // 1) If header is already present → Shopify
    if (fwdHeaders.has(REQUIRED_HEADER) && !isToEdgee) {
      fwdHeaders.set("Host", PUBLIC_HOSTNAME);

      const shopifyReq = new Request(url.toString(), {
        method,
        headers: fwdHeaders,
        body: request.body,
        redirect: "follow",
      });

      const shopifyRes = await fetch(shopifyReq, {
        cf: {
          resolveOverride: SHOPIFY_HOSTNAME,
          cacheTtl: isSensitive ? 0 : undefined,
          cacheEverything: false,
        },
      });

      const out = new Response(shopifyRes.body, shopifyRes);
      out.headers.set("cf-worker-dest", "shopify(header-present)");
      if (isSensitive) out.headers.set("Cache-Control", "no-store");
      return out;
    }

    // 2) For write methods with no header → inject header + go direct to Shopify
    if (isWriteMethod) {
      const h = new Headers(request.headers);
      h.set("Host", PUBLIC_HOSTNAME);
      h.set(REQUIRED_HEADER, REQUIRED_HEADER_VALUE);

      const shopifyReq = new Request(url.toString(), {
        method,
        headers: h,
        body: request.body,
        redirect: "follow",
      });

      const shopifyRes = await fetch(shopifyReq, {
        cf: {
          resolveOverride: SHOPIFY_HOSTNAME,
          cacheTtl: 0,
          cacheEverything: false,
        },
      });

      const out = new Response(shopifyRes.body, shopifyRes);
      out.headers.set("cf-worker-dest", "shopify(write-direct)");
      out.headers.set("Cache-Control", "no-store");
      return out;
    }

    // 3) For GET/HEAD with no header → route via Edgee
    const edgeeUrl = new URL(EDGE_PROXY_URL);
    edgeeUrl.pathname = url.pathname;
    edgeeUrl.search = url.search;

    const h2 = new Headers(request.headers);
    h2.set("X-From-Cloudflare-Worker", "1");

    const edgeeReq = new Request(edgeeUrl.toString(), {
      method,
      headers: h2,
      body: request.body,
      redirect: "follow",
    });

    const edgeeRes = await fetch(edgeeReq);
    const out = new Response(edgeeRes.body, edgeeRes);
    out.headers.set("cf-worker-dest", "edgee");
    if (isSensitive) out.headers.set("Cache-Control", "no-store");
    return out;
  },
};
