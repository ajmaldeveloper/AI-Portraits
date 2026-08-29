// Builds a link back into Shopify Admin for a resource this app created.
//
// The classic /admin/<resource> path still resolves correctly against the
// myshopify domain and redirects into the merchant's current Admin surface,
// so it remains a safe, low-maintenance way to link out from an embedded
// app without needing the shop's admin.shopify.com handle.

export function shopifyProductAdminUrl(shop: string, productGid: string) {
  const numericId = productGid.split("/").pop();

  if (!numericId) {
    return null;
  }

  return `https://${shop}/admin/products/${numericId}`;
}

// The myshopify.com domain always serves the storefront (even when a
// custom domain is also connected), so this is safe to link to directly
// without an extra API call to look up the shop's primary domain.
export function shopifyStorefrontProductUrl(shop: string, handle: string) {
  return `https://${shop}/products/${handle}`;
}

// /admin/themes/current/editor is a documented alias for "whichever
// theme is currently published" — it saves having to look up the live
// theme's numeric id just to deep-link into it.
export function shopifyThemeEditorProductUrl(shop: string, handle: string) {
  return `https://${shop}/admin/themes/current/editor?previewPath=${encodeURIComponent(`/products/${handle}`)}`;
}
