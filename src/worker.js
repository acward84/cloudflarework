// Cloudflare Worker (Modules)
// Route: checkout.testtheedgefun.com/*

export default {
  async fetch(request, env, ctx) {
    const REQUIRED_HEADER  = "X-shopifyEdgee-Auth";            // header expected
    const EDGE_PROXY_URL   = "https://fixcheckedprj.edgee.app"; // Edgee proxy
    const SHOPIFY_HOSTNAME = "shops.myshopify.com";            // Shopify CNAME
    const PUBLIC_HOSTNAME  = "checkout.testtheedgefun.com";    // your domain

    const url = new URL(request.url);

    const isToEdgee = url.hostname === new URL(EDGE_PROXY_URL).hostname;
    const fwdHeaders = new Headers(request.headers);
    const hasHeader = fwdHeaders.has(REQUIRED_HEADER);

    if (hasHeader && !isToEdgee) {
      const shopifyUrl = new URL(request.url);
      fwdHeaders.set("Host", PUBLIC_HOSTNAME);
      // fwdHeaders.delete(REQUIRED_HEADER); // optional: hide from Shopify

      const shopifyReq = new Request(shopifyUrl.toString(), {
        method: request.method,
        headers: fwdHeaders,
        body: request.body,
        redirect: "follow",
      });

      return fetch(shopifyReq, { cf: { resolveOverride: SHOPIFY_HOSTNAME } });
    }

    const edgeeUrl = new URL(EDGE_PROXY_URL);
    edgeeUrl.pathname = url.pathname;
    edgeeUrl.search = url.search;

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
