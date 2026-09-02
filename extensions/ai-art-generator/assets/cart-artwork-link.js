// Global app embed script — see cart-artwork-link.liquid's comment for
// why this rewrites the DOM directly instead of editing any theme
// template. Runs on every page (the cart drawer is usually part of the
// global layout, so no dedicated "cart page" navigation is needed for
// this to catch it), looking only for this app's own short artwork
// preview links and turning that specific text into a clean "Image"
// link — everything else on the page is left untouched.

(function () {
  const ARTWORK_URL_PATTERN =
    /https?:\/\/[^\s"'<>]*\/apps\/[a-z0-9-]+\/artwork\/[a-z0-9]+/gi;

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
