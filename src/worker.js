// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER   = "X-shopifyEdgee-Auth";
    const EDGE_PROXY_URL    = "https://fixcheckedprj.edgee.app";  // Edgee origin
    const SHOPIFY_HOSTNAME  = "shops.myshopify.com";              // Shopify CNAME
    const PUBLIC_HOSTNAME   = "checkout.testtheedgefun.com";      // your domain

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // If you still want to bypass certain Shopify endpoints, list them here.
    // Leave empty [] to send absolutely everything to Edgee when header is missing.
    const BYPASS_PREFIXES = [
      // "/.well-known/shopify/monorail/",
    ];
    const isBypassed = BYPASS_PREFIXES.some(p => url.pathname.startsWith(p));

    // Dynamic paths: never cache
    const isSensitive =
      url.pathname.startsWith("/cart") ||
      url.pathname.startsWith("/checkout") ||
      url.pathname.startsWith("/account");

    const fwdHeaders = new Headers(request.headers);

    // 1) If the required header is already present → go straight to Shopify
    if (fwdHeaders.has(REQUIRED_HEADER)) {
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

    // 2) If the destination is the same as the URL host (i.e., checkout.*)
    //    and the header is NOT present → ALWAYS route via Edgee (all methods, XHR/fetch included)
    if (url.hostname === PUBLIC_HOSTNAME && !isBypassed) {
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
      out.headers.set("cf-worker-dest", "edgee(all-same-origin)");
      if (isSensitive) out.headers.set("Cache-Control", "no-store");
      return out;
    }

    // 3) Fallback (rare in this route): direct to Shopify
    const h = new Headers(request.headers);
    h.set("Host", PUBLIC_HOSTNAME);

    const shopifyReq = new Request(url.toString(), {
      method,
      headers: h,
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
    out.headers.set("cf-worker-dest", "shopify(fallback)");
    if (isSensitive) out.headers.set("Cache-Control", "no-store");
    return out;
  },
};
