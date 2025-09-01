// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER = "X-Edgee-Auth";              // the header you expect
    const EDGE_PROXY_URL  = "https://edgee.yourdomain.com"; // your Edgee endpoint (acts as upstream/origin)
    const SHOPIFY_HOSTNAME = "shops.myshopify.com";      // Shopify CNAME

    const url = new URL(request.url);

    // 1) Basic loop protection — if request is already going to Edgee, don't bounce again.
    const isToEdgee = url.hostname === new URL(EDGE_PROXY_URL).hostname;

    // 2) Clone the incoming request headers to forward downstream,
    //    but never leak Cloudflare-internal headers back to clients.
    const fwdHeaders = new Headers(request.headers);

    // 3) Decide destination
    const hasHeader = fwdHeaders.has(REQUIRED_HEADER);

    if (hasHeader && !isToEdgee) {
      // ---------- Go to Shopify ----------
      // Keep the public host (checkout.testtheedgefun.com) but resolve to shops.myshopify.com.
      // This keeps Shopify happy with your custom domain while still using the Shopify origin.
      const shopifyUrl = new URL(request.url);
      // Ensure the Host we present to origin is your public host
      fwdHeaders.set("Host", "checkout.testtheedgefun.com");

      // Optional: remove the internal header before going to Shopify if you don't want Shopify to see it
      // fwdHeaders.delete(REQUIRED_HEADER);

      const shopifyReq = new Request(shopifyUrl.toString(), {
        method: request.method,
        headers: fwdHeaders,
        body: request.body,
        redirect: "follow",
      });

      return fetch(shopifyReq, {
        // Resolve DNS to Shopify's canonical name but keep Host header above
        cf: { resolveOverride: SHOPIFY_HOSTNAME },
      });
    }

    // ---------- Go to Edgee ----------
    // Edgee should act like an origin: accept the request, add REQUIRED_HEADER when it calls Shopify,
    // and return the final response body to us (no client redirect).
    // We forward the original path/query to Edgee.
    const edgeeUrl = new URL(EDGE_PROXY_URL);
    edgeeUrl.pathname = url.pathname;
    edgeeUrl.search = url.search;

    // Mark the hop so Edgee knows this came from Cloudflare Worker (optional, for debugging)
    fwdHeaders.set("X-From-Cloudflare-Worker", "1");

    // DO NOT add the REQUIRED_HEADER here; per your flow, Edgee adds it itself when calling Shopify.
    const edgeeReq = new Request(edgeeUrl.toString(), {
      method: request.method,
      headers: fwdHeaders,
      body: request.body,
      redirect: "follow",
    });

    return fetch(edgeeReq);
  },
};
