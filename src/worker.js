// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER   = "X-shopifyEdgee-Auth";          // required header
    const EDGE_PROXY_URL    = "https://checkouttest.edgee.app"; // Edgee origin
    const SHOPIFY_HOSTNAME  = "shops.myshopify.com";           // Shopify CNAME
    const PUBLIC_HOSTNAME   = "checkout.testtheedgefun.com";   // your domain

    const url = new URL(request.url);

    // Identify sensitive (dynamic) paths: never cache
    const isSensitive =
      url.pathname.startsWith("/cart") ||
      url.pathname.startsWith("/checkout") ||
      url.pathname.startsWith("/account");

    // Clone incoming headers to forward downstream
    const fwdHeaders = new Headers(request.headers);

    // Prevent loops when the incoming request is already to Edgee (shouldn't happen normally)
    const isToEdgee = url.hostname === new URL(EDGE_PROXY_URL).hostname;

    // If the required header is already present and we're not already going to Edgee → Shopify
    if (fwdHeaders.has(REQUIRED_HEADER) && !isToEdgee) {
      // Keep your custom host so Shopify sets cookies for checkout.testtheedgefun.com
      fwdHeaders.set("Host", PUBLIC_HOSTNAME);
      // Optional: hide the internal header from Shopify
      // fwdHeaders.delete(REQUIRED_HEADER);

      const shopifyReq = new Request(url.toString(), {
        method: request.method,
        headers: fwdHeaders,
        body: request.body,     // streams POST body unchanged
        redirect: "follow",
      });

      const shopifyRes = await fetch(shopifyReq, {
        cf: {
          resolveOverride: SHOPIFY_HOSTNAME,
          cacheTtl: isSensitive ? 0 : undefined,
          cacheEverything: false,
        },
      });

      // Debug tag to confirm route (remove later if you want)
      const out = new Response(shopifyRes.body, shopifyRes);
      out.headers.set("cf-worker-dest", "shopify");
      if (isSensitive) out.headers.set("Cache-Control", "no-store");
      return out;
    }

    // Otherwise → Edgee. Edgee will add REQUIRED_HEADER and forward to Shopify.
    const edgeeUrl = new URL(EDGE_PROXY_URL);
    edgeeUrl.pathname = url.pathname;
    edgeeUrl.search = url.search;

    // Optional debug marker so you can see the hop in logs/headers
    fwdHeaders.set("X-From-Cloudflare-Worker", "1");

    const edgeeReq = new Request(edgeeUrl.toString(), {
      method: request.method,
      headers: fwdHeaders,
      body: request.body,
      redirect: "follow",
    });

    const edgeeRes = await fetch(edgeeReq);
    const out = new Response(edgeeRes.body, edgeeRes);
    out.headers.set("cf-worker-dest", "edgee");
    if (isSensitive) out.headers.set("Cache-Control", "no-store");
    return out;

    /* ───────────────────────────────────────────────────────────────────────────────
