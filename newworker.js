// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER  = "X-shopifyEdgee-Auth";       // header expected
    const EDGE_PROXY_URL   = "https://checkouttest.edgee.app"; // your Edgee proxy
    const SHOPIFY_HOSTNAME = "shops.myshopify.com";       // Shopify canonical CNAME
    const PUBLIC_HOSTNAME  = "checkout.testtheedgefun.com"; // your custom Shopify domain

    const url = new URL(request.url);

    // Prevent infinite loops if request is already going to Edgee
    const isToEdgee = url.hostname === new URL(EDGE_PROXY_URL).hostname;

    // Clone incoming headers to forward downstream
    const fwdHeaders = new Headers(request.headers);

    // Check if header is present
    const hasHeader = fwdHeaders.has(REQUIRED_HEADER);

    if (hasHeader && !isToEdgee) {
      // ---------- Forward to Shopify ----------
      const shopifyUrl = new URL(request.url);

      // Ensure Host header matches your custom domain
      fwdHeaders.set("Host", PUBLIC_HOSTNAME);

      // Optional: don’t let Shopify see the internal header
      // fwdHeaders.delete(REQUIRED_HEADER);

      const shopifyReq = new Request(shopifyUrl.toString(), {
        method: request.method,
        headers: fwdHeaders,
        body: request.body,
        redirect: "follow",
      });

      return fetch(shopifyReq, {
        // Resolve to Shopify’s canonical hostname while keeping Host as PUBLIC_HOSTNAME
        cf: { resolveOverride: SHOPIFY_HOSTNAME },
      });
    }

    // ---------- Forward to Edgee ----------
    const edgeeUrl = new URL(EDGE_PROXY_URL);
    edgeeUrl.pathname = url.pathname;
    edgeeUrl.search = url.search;

    // Optional debug header
    fwdHeaders.set("X-From-Cloudflare-Worker", "1");

    const edgeeReq = new Request(edgeeUrl.toString(), {
      method: request.method,
      headers: fwdHeaders,
      body: request.body,
      redirect: "follow",
    });

    return fetch(edgeeReq);
  },
};
