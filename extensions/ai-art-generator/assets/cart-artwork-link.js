// Global app embed script — see cart-artwork-link.liquid's comment for
// why this rewrites the DOM directly instead of editing any theme
// template. Runs on every page (the cart drawer is usually part of the
// global layout, so no dedicated "cart page" navigation is needed for
// this to catch it): (1) turns this app's own short artwork preview
// links into a clean "Image" link, and (2) hides the two invisible
// carrier products (see style-pricing-sync.server.ts) the Cart
// Transform Function adds to a cart line — they exist purely to carry
// a price surcharge and, when needed, physical shipping onto the
// order; a customer was never meant to see their raw product titles
// as extra line items.

(function () {
  const ARTWORK_URL_PATTERN =
    /https?:\/\/[^\s"'<>]*\/apps\/[a-z0-9-]+\/artwork\/[a-z0-9]+/gi;

  // Must match ADJUSTMENT_PRODUCT_TITLE / SHIPPING_PRODUCT_TITLE in
  // app/services/styles/style-pricing-sync.server.ts exactly.
  const INTERNAL_CARRIER_TITLES = [
    "Winslet AI Portraits — pricing adjustment",
    "Winslet AI Portraits — shipping carrier",
  ];

  const HIDDEN_MARKER = "data-aig-carrier-hidden";

  function normalizeWhitespace(text) {
    return text ? text.replace(/\s+/g, " ").trim() : "";
  }

  // Matching on a single text node's nodeValue (the original approach)
  // silently finds nothing whenever a theme splits a line's markup
  // across more than one text node or inline element (e.g. the em
  // dash and the rest of the title each getting their own <span>) —
  // textContent aggregates across all of an element's descendants, so
  // matching against that instead is robust to however a given theme
  // happens to structure one cart line's markup. Elements are checked
  // deepest-first (reverse document order) so the tightest wrapper for
  // a line — not some much larger ancestor that happens to still
  // contain the same text — is the one that gets hidden; once a
  // descendant is hidden, its still-in-the-DOM text would otherwise
  // make every ancestor look like a match too, so those are skipped.
  function hideCarrierLines(root) {
    if (typeof root.querySelectorAll !== "function") {
      return;
    }

    const elements = Array.from(root.querySelectorAll("*")).reverse();

    for (const title of INTERNAL_CARRIER_TITLES) {
      for (const el of elements) {
        if (
          el.hasAttribute(HIDDEN_MARKER) ||
          el.querySelector(`[${HIDDEN_MARKER}]`)
        ) {
          continue;
        }

        if (!normalizeWhitespace(el.textContent).includes(title)) {
          continue;
        }

        el.setAttribute(HIDDEN_MARKER, "true");
        el.hidden = true;
      }
    }
  }

  function replaceUrlsInTextNode(textNode) {
    const text = textNode.nodeValue;

    ARTWORK_URL_PATTERN.lastIndex = 0;

    if (!ARTWORK_URL_PATTERN.test(text)) {
      return;
    }

    ARTWORK_URL_PATTERN.lastIndex = 0;

    const fragment = document.createDocumentFragment();

    let lastIndex = 0;
    let match;

    while ((match = ARTWORK_URL_PATTERN.exec(text))) {
      const url = match[0];

      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index)),
        );
      }

      const link = document.createElement("a");

      link.href = url;
      link.textContent = "Image";
      link.className = "aig-artwork-link";
      link.target = "_blank";
      link.rel = "noopener";
      link.setAttribute("download", "");

      fragment.appendChild(link);

      lastIndex = match.index + url.length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  function scan(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes("/artwork/")) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const matches = [];

    let node = walker.nextNode();

    while (node) {
      matches.push(node);
      node = walker.nextNode();
    }

    for (const textNode of matches) {
      // A previous pass may have already replaced this exact node's
      // parent chain — skip anything already inside a link we made.
      if (textNode.parentElement?.closest("a.aig-artwork-link")) {
        continue;
      }

      replaceUrlsInTextNode(textNode);
    }
  }

  // Some themes (e.g. Shopify's newer Web Component-based cart
  // drawers) render their cart contents inside an open shadow root
  // rather than plain light DOM — a TreeWalker rooted at document.body
  // never sees into those, which is why the carrier titles above kept
  // showing up even with hideCarrierLines() in place. processRoot()
  // treats document.body and every open shadow root it finds (however
  // deeply nested) the same way: scan/hide within it, then watch it
  // (via its own MutationObserver, since observing document.body with
  // {subtree:true} does not cross shadow boundaries either) for
  // further changes and newly-appeared shadow roots.
  const observedRoots = new WeakSet();

  function discoverShadowRoots(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    let el = walker.nextNode();

    while (el) {
      if (el.shadowRoot && !observedRoots.has(el.shadowRoot)) {
        processRoot(el.shadowRoot);
      }

      el = walker.nextNode();
    }
  }

  function observeRoot(root) {
    if (observedRoots.has(root)) {
      return;
    }

    observedRoots.add(root);

    let scheduled = false;

    const observer = new MutationObserver(() => {
      if (scheduled) {
        return;
      }

      scheduled = true;

      requestAnimationFrame(() => {
        scheduled = false;
        processRoot(root);
      });
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function processRoot(root) {
    scan(root);
    hideCarrierLines(root);
    observeRoot(root);
    discoverShadowRoots(root);
  }

  // A component that attaches its shadow root after this script has
  // already run (e.g. one defined/upgraded later) would otherwise
  // never be found by discoverShadowRoots() — this catches it the
  // moment it's created. queueMicrotask gives the component a chance
  // to populate its own shadow DOM on this same turn before the first
  // scan runs.
  const originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function attachShadow(init) {
    const shadowRoot = originalAttachShadow.call(this, init);

    queueMicrotask(() => processRoot(shadowRoot));

    return shadowRoot;
  };

  function run() {
    if (document.body) {
      processRoot(document.body);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
