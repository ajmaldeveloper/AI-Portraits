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

  // Finds the tightest ancestor whose own text is essentially just the
  // carrier title (no theme markup gives this a dedicated class to
  // target, so this walks up from the matching text node only while
  // each ancestor's text stays close to the title's own length —
  // once an ancestor's text grows well past that, the previous one
  // was the dedicated wrapper for this one line, not a container
  // shared with the rest of the cart line).
  function findLineWrapper(textNode, title) {
    let candidate = textNode.parentElement;
    let el = candidate;

    while (el && el !== document.body) {
      const trimmed = el.textContent ? el.textContent.trim() : "";

      if (trimmed.length > title.length + 40) {
        break;
      }

      candidate = el;
      el = el.parentElement;
    }

    return candidate;
  }

  function hideCarrierLines(root) {
    for (const title of INTERNAL_CARRIER_TITLES) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.nodeValue && node.nodeValue.includes(title)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      });

      let node = walker.nextNode();

      while (node) {
        const wrapper = findLineWrapper(node, title);

        if (wrapper && !wrapper.hasAttribute(HIDDEN_MARKER)) {
          wrapper.setAttribute(HIDDEN_MARKER, "true");
          wrapper.hidden = true;
        }

        node = walker.nextNode();
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

  function run() {
    if (document.body) {
      scan(document.body);
      hideCarrierLines(document.body);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  // Cart drawers/pages usually render their contents after an
  // AJAX add-to-cart, well after this script first runs — a debounced
  // MutationObserver catches that (and any theme re-rendering the cart
  // later) without polling.
  let scheduled = false;

  const observer = new MutationObserver(() => {
    if (scheduled) {
      return;
    }

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
  }
})();
