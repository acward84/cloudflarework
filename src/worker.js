// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER    = "X-shopifyEdgee-Auth";               // required header
    const EDGE_PROXY_URL     = "https://fixcheckedprj.edgee.app";   // Edgee origin
    const SHOPIFY_HOSTNAME   = "shops.myshopify.com";               // Shopify CNAME
    const PUBLIC_HOSTNAME    = "checkout.testtheedgefun.com";       // your domain

    // Optional secret value if you want the Worker to inject the header on writes
    // Set with: npx wrangler secret put EDGE_AUTH_VALUE
    const REQUIRED_HEADER_VALUE = env.EDGE_AUTH_VALUE || "1";

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // ---- BYPASS LIST: always go straight to Shopify (no Edgee, no caching) ----
    const BYPASS_PREFIXES = [
      "/.well-known/shopify/monorail/", // e.g. /.well-known/shopify/monorail/v1/produce
    ];
    const isBypassed = BYPASS_PREFIXES.some(p => url.pathname.startsWith(p));
    if (isBypassed) {
      const h = new Headers(request.headers);
      h.set("Host", PUBLIC_HOSTNAME);
      const directReq = new Request(url.toString(), { method, headers: h, body: request.body, redirect: "follow" });
      const directRes = await fetch(directReq, {
        cf: { resolveOverride: SHOPIFY_HOSTNAME, cacheTtl: 0, cacheEverything: false },
      });
      const out = new Response(directRes.body, directRes);
      out.headers.set("cf-worker-dest", "shopify(bypass)");
      out.headers.set("Cache-Control", "no-store");
      return out;
    }
    // -------------------------------------------------------------------------

    // “Sensitive” dynamic paths: don’t cache
    const isSensitive =
      url.pathname.startsWith("/cart") ||
      url.pathname.startsWith("/checkout") ||
      url.pathname.startsWith("/account");

    // Write-y methods we never want to send through Edgee
    const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method);

    // Detect top-level navigation vs subresource/XHR
    const secFetchDest = request.headers.get("Sec-Fetch-Dest") || "";
    const secFetchMode = request.headers.get("Sec-Fetch-Mode") || "";
    // Consider it a navigation if the browser says so (document) or mode=navigate
    const isTopLevelNavigation =
      secFetchDest === "document" || secFetchMode === "navigate";

    // Clone headers
    const fwdHeaders = new Headers(request.headers);

    // 1) If the header is already present → always direct to Shopify
    if (fwdHeaders.has(REQUIRED_HEADER)) {
      fwdHeaders.set("Host", PUBLIC_HOSTNAME);
      const shopifyReq = new Request(url.toString(), { method, headers: fwdHeaders, body: request.body, redirect: "follow" });
      const shopifyRes = await fetch(shopifyReq, {
        cf: { resolveOverride: SHOPIFY_HOSTNAME, cacheTtl: isSensitive ? 0 : undefined, cacheEverything: false },
      });
      const out = new Response(shopifyRes.body, shopifyRes);
      out.headers.set("cf-worker-dest", "shopify(header-present)");
      if (isSensitive) out.headers.set("Cache-Control", "no-store");
      return out;
    }

    // 2) For write methods with NO header → inject header & go direct to Shopify (skip Edgee)
    if (isWriteMethod) {
      const h = new Headers(request.headers);
      h.set("Host", PUBLIC_HOSTNAME);
      h.set(REQUIRED_HEADER, REQUIRED_HEADER_VALUE);

      const shopifyReq = new Request(url.toString(), { method, headers: h, body: request.body, redirect: "follow" });
      const shopifyRes = await fetch(shopifyReq, {
        cf: { resolveOverride: SHOPIFY_HOSTNAME, cacheTtl: 0, cacheEverything: false },
      });
      const out = new Response(shopifyRes.body, shopifyRes);
      out.headers.set("cf-worker-dest", "shopify(write-direct)");
      out.headers.set("Cache-Control", "no-store");
      return out;
    }

    // 3) READS with NO header:
    //    If it's a top-level HTML navigation, route via Edgee (your original gate).
    //    If it's a same-origin subrequest (scripts, XHR, images, etc.), go direct to Shopify.
    if (method === "GET" || method === "HEAD") {
      if (isTopLevelNavigation) {
        // → Edgee ONLY for the initial document navigation
        const edgeeUrl = new URL(EDGE_PROXY_URL);
        edgeeUrl.pathname = url.pathname;
        edgeeUrl.search = url.search;

        const h2 = new Headers(request.headers);
        h2.set("X-From-Cloudflare-Worker", "1");

        const edgeeReq = new Request(edgeeUrl.toString(), { method, headers: h2, body: request.body, redirect: "follow" });
        const edgeeRes = await fetch(edgeeReq);
        const out = new Response(edgeeRes.body, edgeeRes);
        out.headers.set("cf-worker-dest", "edgee(navigation)");
        if (isSensitive) out.headers.set("Cache-Control", "no-store");
        return out;
      } else {
        // → Direct to Shopify for subrequests to checkout.* (ignore Edgee)
        const h = new Headers(request.headers);
        h.set("Host", PUBLIC_HOSTNAME);

        const shopifyReq = new Request(url.toString(), { method, headers: h, body: request.body, redirect: "follow" });
        const shopifyRes = await fetch(shopifyReq, {
          cf: { resolveOverride: SHOPIFY_HOSTNAME, cacheTtl: isSensitive ? 0 : undefined, cacheEverything: false },
        });
        const out = new Response(shopifyRes.body, shopifyRes);
        out.headers.set("cf-worker-dest", "shopify(subrequest)");
        if (isSensitive) out.headers.set("Cache-Control", "no-store");
        return out;
      }
    }

    // Fallback (shouldn't be hit often)
    const h = new Headers(request.headers);
    h.set("Host", PUBLIC_HOSTNAME);
    const shopifyReq = new Request(url.toString(), { method, headers: h, body: request.body, redirect: "follow" });
    const shopifyRes = await fetch(shopifyReq, {
      cf: { resolveOverride: SHOPIFY_HOSTNAME, cacheTtl: isSensitive ? 0 : undefined, cacheEverything: false },
    });
    const out = new Response(shopifyRes.body, shopifyRes);
    out.headers.set("cf-worker-dest", "shopify(fallback)");
    if (isSensitive) out.headers.set("Cache-Control", "no-store");
    return out;
  },
};
