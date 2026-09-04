// Renders the customer-facing personalization form: fetches the
// Style's field definitions from the app proxy, lets the shopper
// upload a photo and fill in any other fields, submits it, and polls
// for the generated result. No framework — this ships straight to the
// storefront, so it stays dependency-free.
//
// Product options (Size, Framing, Mat color, everything on the
// merchant's Product options tab) are never modeled as real Shopify
// product variants — the linked Shopify product is always a plain
// single-variant product. This component renders every option itself
// and prices it client-side purely for display; the actual charge is
// applied at checkout by the ai-art-generator-price-transform Cart
// Transform Function, which re-derives the same total server-side from
// the selections recorded on the cart line (see wireCartGate below).

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // ~3 minutes

class AiArtGenerator extends HTMLElement {
  constructor() {
    super();

    this.styleId = this.dataset.aigStyleId || "";
    this.proxyRoot = this.dataset.aigProxyRoot || "/apps/ai-art-studio";
    this.heading = this.dataset.aigHeading || "";
    this.buttonLabel = this.dataset.aigButtonLabel || "Generate my artwork";

    this.fields = [];
    this.photoFile = null;
    this.pollTimer = null;

    this.basePrice = "0";

    // Swatch box size / label font size — global to the whole Style,
    // applying uniformly to every option's choice swatches (not set
    // per option). null = use the built-in default.
    this.swatchWidthPx = null;
    this.swatchHeightPx = null;
    this.swatchFontSizePx = null;
    this.swatchWidthMobilePx = null;
    this.swatchHeightMobilePx = null;
    this.swatchFontSizeMobilePx = null;
    this.swatchGapPx = null;
    this.swatchBorderColor = null;
    this.swatchActiveBorderColor = null;
    this.swatchFullBleed = false;

    // Every Product option on this Style — any option's choices may
    // optionally carry a price (priceDelta) — see
    // app-proxy.styles.$styleId.tsx for the exact shape.
    this.options = [];

    // { [optionId]: choiceId } — which choice is currently picked for
    // each option. Populated with a sensible default per option as
    // soon as options load (see defaultSelections()).
    this.selectedChoices = {};

    // Captured at submit time — the form's own inputs are gone by the
    // time the theme's native "Add to cart" is clicked, since a
    // finished generation replaces this element's whole contents with
    // just the result image.
    this.submittedFieldValues = {};
    this.submittedPersonalization = "";
    this.generationId = null;
    this.generationResultUrl = null;
  }

  connectedCallback() {
    if (!this.styleId) {
      return;
    }

    this.loadStyle();
    this.wireCartGate();
  }

  disconnectedCallback() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
  }

  // Hooks the theme's own native "Add to cart" form directly — same
  // approach as this shop's Product Options app: a capturing submit
  // listener blocks the native submission when personalization isn't
  // finished yet, and the form's own "formdata" event is used to
  // attach the generation result, the customer's option selections,
  // and field answers as line item properties, rather than building a
  // separate cart request.
  wireCartGate() {
    const form = findProductForm(this);

    if (!form) {
      return;
    }

    this.cartForm = form;

    form.addEventListener(
      "submit",
      (event) => {
        if (!this.validateForCart()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    form.addEventListener("formdata", (event) => {
      if (!this.generationResultUrl) {
        return;
      }

      const framingChoice = this.selectedFramingChoice();

      const isFramed = Boolean(
        framingChoice?.hexColor || framingChoice?.imageUrl,
      );

      // Shopify hides any property whose key starts with "_" from the
      // cart, checkout, and order confirmation — kept purely for
      // backend/fulfillment use (visible to the merchant in the
      // order's admin view).
      event.formData.set(
        "properties[_ai_art_generation_id]",
        this.generationId || "",
      );

      // Read by the ai-art-generator-price-transform Cart Transform
      // Function at checkout (see its own cart_transform_run.graphql/
      // .js) to compute the real surcharge and, if the Framing choice
      // needs it, add the shipping-carrier line — this is the only
      // place pricing actually gets applied; everything shown in this
      // widget is a preview of the same math. Set whenever any option
      // is configured at all, not just priced ones — a $0 Framing
      // choice still needs to reach the Function so it can add the
      // shipping-carrier line.
      if (this.hasConfiguredOptions()) {
        event.formData.set("properties[_aig_option_set]", this.styleId);

        event.formData.set(
          "properties[_aig_selections]",
          JSON.stringify(this.selectedChoices),
        );
      }

      // The artwork link: kept private (a "_"-prefixed key, which
      // Shopify hides from the cart, checkout, and order confirmation)
      // — visible to the merchant in the order's own admin view, not
      // to the customer. The short redirect link (no query
      // string/signature, beyond an optional frame/mat color) is the
      // value, so even there it reads as a clean short URL rather than
      // a wall of raw text. When the selected Framing choice carries a
      // color, it (and any extra color choice, e.g. Mat color) is
      // passed through so the linked copy has the same mat + frame
      // border composited in as what was actually ordered — see
      // media.style-assets.$assetId.ts. An uploaded frame texture
      // isn't baked into the linked file (see that route's own
      // comment on the scope boundary). The link itself still downloads
      // on click (Content-Disposition: attachment on the redirect
      // target).
      if (this.generationId) {
        const artworkUrl = new URL(
          `${this.proxyRoot}/artwork/${encodeURIComponent(this.generationId)}`,
          window.location.origin,
        );

        if (framingChoice?.hexColor) {
          artworkUrl.searchParams.set(
            "frame",
            framingChoice.hexColor.replace(/^#/, ""),
          );

          const matChoice = this.selectedMatColorChoice();

          if (matChoice?.hexColor) {
            artworkUrl.searchParams.set(
              "mat",
              matChoice.hexColor.replace(/^#/, ""),
            );
          }
        }

        event.formData.set(
          "properties[_ai_art_preview]",
          artworkUrl.toString(),
        );
      }

      // Every option the customer actually picked, recorded as a
      // regular (visible) line item property — e.g. "Print size: 16x20
      // in", "Framing: Black", "Mat color: Ivory" — whatever the
      // merchant named the option.
      for (const option of this.options) {
        const choice = this.choiceFor(option);

        if (!choice) {
          continue;
        }

        event.formData.set(`properties[${option.label}]`, choice.label);
      }

      for (const [key, value] of Object.entries(this.submittedFieldValues)) {
        if (!value) {
          continue;
        }

        const field = this.fields.find((item) => item.key === key);

        const label = field ? field.label : key;

        event.formData.set(`properties[${label}]`, value);
      }

      // Personalization free-text is an instruction to the AI during
      // generation only (e.g. "make the hair black") — not something a
      // customer needs restated back to them as an order line item.
    });
  }

  // A required image field means the whole product is "upload a photo,
  // get it transformed" — so the gate is generation having actually
  // completed, not just a photo being selected, since that's the only
  // point at which there's a result to attach to the order at all.
  validateForCart() {
    const imageField = this.fields.find((field) => field.type === "IMAGE");

    if (imageField?.required && !this.generationResultUrl) {
      this.flashCartError(
        this.photoFile
          ? "Generate your personalized artwork before adding to cart."
          : "Upload a photo and generate your artwork before adding to cart.",
      );

      return false;
    }

    return true;
  }

  flashCartError(message) {
    this.scrollIntoView({ behavior: "smooth", block: "center" });

    if (this.querySelector(".aig-form")) {
      this.showFormError(message);

      return;
    }

    this.renderError(message);
  }

  async loadStyle() {
    this.renderLoading();

    try {
      const response = await fetch(
        `${this.proxyRoot}/styles/${encodeURIComponent(this.styleId)}`,
      );

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        this.renderError(
          payload.error || "This product isn't available right now.",
        );

        return;
      }

      this.fields = payload.fields || [];
      this.basePrice = payload.basePrice || "0";
      this.swatchWidthPx = payload.swatchWidthPx ?? null;
      this.swatchHeightPx = payload.swatchHeightPx ?? null;
      this.swatchFontSizePx = payload.swatchFontSizePx ?? null;
      this.swatchWidthMobilePx = payload.swatchWidthMobilePx ?? null;
      this.swatchHeightMobilePx = payload.swatchHeightMobilePx ?? null;
      this.swatchFontSizeMobilePx = payload.swatchFontSizeMobilePx ?? null;
      this.swatchGapPx = payload.swatchGapPx ?? null;
      this.swatchBorderColor = payload.swatchBorderColor ?? null;
      this.swatchActiveBorderColor = payload.swatchActiveBorderColor ?? null;
      this.swatchFullBleed = Boolean(payload.swatchFullBleed);
      this.options = payload.options || [];
      this.selectedChoices = this.defaultSelections();

      this.renderForm();
    } catch {
      this.renderError("Could not load the personalization form.");
    }
  }

  // One sensible default choice per option, picked before the customer
  // has interacted at all, so the frame preview and the price total are
  // both correct the instant a result appears. The Size axis defaults
  // to whichever choice is the product's base price (scalePercent
  // 100) rather than just the first one, since that's the size the
  // Shopify product itself is actually priced at.
  defaultSelections() {
    const selections = {};

    for (const option of this.options) {
      if (option.choices.length === 0) {
        continue;
      }

      const baseChoice =
        option.axisRole === "SIZE"
          ? option.choices.find((choice) => choice.scalePercent === 100)
          : null;

      selections[option.id] = (baseChoice || option.choices[0]).id;
    }

    return selections;
  }

  choiceFor(option) {
    const choiceId = this.selectedChoices[option.id];

    return option.choices.find((choice) => choice.id === choiceId) || null;
  }

  sizeOption() {
    return this.options.find((option) => option.axisRole === "SIZE") || null;
  }

  framingOption() {
    return this.options.find((option) => option.axisRole === "FRAMING") || null;
  }

  selectedFramingChoice() {
    const option = this.framingOption();

    return option ? this.choiceFor(option) : null;
  }

  // First color-carrying option OTHER than Framing itself — in
  // practice there's normally just one (Mat color), but this stays
  // correct if a merchant sets up more than one.
  selectedMatColorChoice() {
    for (const option of this.options) {
      if (option.axisRole === "FRAMING" || option.type !== "COLOR_SWATCH") {
        continue;
      }

      const choice = this.choiceFor(option);

      if (choice?.hexColor || choice?.imageUrl) {
        return choice;
      }
    }

    return null;
  }

  hasConfiguredOptions() {
    return this.options.some((option) => option.choices.length > 0);
  }

  // Purely a preview of what the Cart Transform Function will actually
  // charge at checkout (see that Function's own computeStyleTotal,
  // which this mirrors) — never the value actually billed, so a
  // mismatch here can only ever under/over-represent the price shown,
  // not the price paid. Every option's selected choice is a delta on
  // top of the base price — there's no "absolute price" axis.
  computeTotal() {
    let total = Number(this.basePrice) || 0;

    for (const option of this.options) {
      const choice = this.choiceFor(option);

      if (choice && choice.priceDelta !== null) {
        total += Number(choice.priceDelta) || 0;
      }
    }

    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  renderLoading() {
    this.innerHTML = `<div class="aig-spinner" role="status" aria-label="Loading"></div>`;
  }

  renderError(message) {
    this.innerHTML = `<div class="aig-error">${escapeHtml(message)}</div>`;
  }

  renderForm() {
    this.photoFile = null;

    const imageField = this.fields.find((field) => field.type === "IMAGE");

    const nonImageFields = this.fields.filter(
      (field) => field.type !== "IMAGE",
    );

    const headingHtml = this.heading
      ? `<h3 class="aig-heading">${escapeHtml(this.heading)}</h3>`
      : "";

    // Rendered in the same order the merchant configured them in —
    // fields no longer get sorted image-first regardless of position.
    const fieldsHtml = this.fields
      .map((field) =>
        field.type === "IMAGE" ? renderImageField(field) : renderField(field),
      )
      .join("");

    // Options and their running total are shown up front — before the
    // customer has even uploaded a photo — so the price is visible the
    // whole time, not just once a result exists. The same options
    // markup (and this.selectedChoices state) carries through into
    // renderResult() once generation finishes, where the frame preview
    // also becomes available.
    this.innerHTML = `
      ${headingHtml}
      ${this.renderOptionsHtml()}
      <form class="aig-form" novalidate>
        ${fieldsHtml}
        <button type="submit" class="aig-submit">${escapeHtml(this.buttonLabel)}</button>
      </form>
    `;

    const form = this.querySelector(".aig-form");

    if (imageField) {
      this.wireDropzone(imageField.id);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      this.submitForm(form, imageField, nonImageFields);
    });

    this.wireOptionChips();
    this.updatePriceSummary();
  }

  wireDropzone(fieldId) {
    const dropzone = this.querySelector(`[data-aig-dropzone="${fieldId}"]`);

    const input = this.querySelector(`[data-aig-file-input="${fieldId}"]`);

    const personalize = this.querySelector(
      `[data-aig-personalize="${fieldId}"]`,
    );

    if (!dropzone || !input) {
      return;
    }

    const selectFile = (file) => {
      this.photoFile = file;

      renderFilledDropzone(dropzone, file, () => clearFile());

      if (personalize) {
        personalize.hidden = false;
      }
    };

    const clearFile = () => {
      this.photoFile = null;

      input.value = "";

      renderEmptyDropzone(dropzone);

      if (personalize) {
        personalize.hidden = true;

        const personalizeInput = personalize.querySelector(".aig-control");

        if (personalizeInput) {
          personalizeInput.value = "";
        }
      }
    };

    renderEmptyDropzone(dropzone);

    dropzone.addEventListener("click", () => input.click());

    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        input.click();
      }
    });

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];

      if (file) {
        selectFile(file);
      }
    });

    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();

      dropzone.classList.add("aig-dropzone--dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("aig-dropzone--dragover");
    });

    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();

      dropzone.classList.remove("aig-dropzone--dragover");

      const file = event.dataTransfer?.files?.[0];

      if (file) {
        const transfer = new DataTransfer();

        transfer.items.add(file);

        input.files = transfer.files;

        selectFile(file);
      }
    });
  }

  async submitForm(form, imageField, nonImageFields) {
    if (imageField && !this.photoFile) {
      this.showFormError("Choose a photo to upload.");

      return;
    }

    const fieldValues = {};

    for (const field of nonImageFields) {
      const control = form.querySelector(`[name="field_${field.id}"]`);

      if (!control) {
        continue;
      }

      const value =
        control.type === "checkbox"
          ? control.checked
            ? "true"
            : ""
          : control.value;

      if (field.required && !value.trim()) {
        this.showFormError(`${field.label} is required.`);

        return;
      }

      fieldValues[field.key] = value;
    }

    this.submittedFieldValues = fieldValues;

    const personalizationInput = form.querySelector('[name="personalization"]');

    this.submittedPersonalization = personalizationInput
      ? personalizationInput.value.trim()
      : "";

    const submitButton = form.querySelector(".aig-submit");

    submitButton.disabled = true;

    submitButton.textContent = "Generating…";

    const body = new FormData();

    body.set("styleId", this.styleId);
    body.set("fieldValues", JSON.stringify(fieldValues));
    body.set("personalization", this.submittedPersonalization);

    if (this.photoFile) {
      body.set("photo", this.photoFile);
    }

    try {
      const response = await fetch(`${this.proxyRoot}/generate`, {
        method: "POST",
        body,
      });

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        this.renderError(payload.error || "Could not start generation.");

        return;
      }

      this.renderStatus("Generating your artwork…");

      this.pollGeneration(payload.generationId, 0);
    } catch {
      this.renderError("Could not reach the server. Please try again.");
    }
  }

  showFormError(message) {
    const existing = this.querySelector(".aig-error");

    if (existing) {
      existing.remove();
    }

    const banner = document.createElement("div");

    banner.className = "aig-error";
    banner.textContent = message;

    const form = this.querySelector(".aig-form");

    form.insertBefore(banner, form.firstChild);
  }

  // Keeps the options/price panel visible through generation too, not
  // just before and after — the customer can keep changing Size/
  // Framing/Mat color while the artwork is being generated, and the
  // price stays accurate the whole time.
  renderStatus(message) {
    this.innerHTML = `
      ${this.renderOptionsHtml()}
      <div class="aig-spinner" role="status"></div>
      <p class="aig-status-text">${escapeHtml(message)}</p>
    `;

    this.wireOptionChips();
    this.updatePriceSummary();
  }

  pollGeneration(generationId, attempt) {
    if (attempt >= MAX_POLL_ATTEMPTS) {
      this.renderError(
        "This is taking longer than expected. Please try again in a moment.",
      );

      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${this.proxyRoot}/generations/${encodeURIComponent(generationId)}`,
        );

        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          this.renderError(payload.error || "Generation failed.");

          return;
        }

        if (payload.status === "SUCCEEDED" && payload.resultUrl) {
          this.generationId = generationId;
          this.generationResultUrl = payload.resultUrl;

          this.renderResult(payload.resultUrl);

          return;
        }

        if (payload.status === "FAILED") {
          this.renderError(payload.errorMessage || "Image generation failed.");

          return;
        }

        this.pollGeneration(generationId, attempt + 1);
      } catch {
        this.pollGeneration(generationId, attempt + 1);
      }
    }, POLL_INTERVAL_MS);
  }

  renderResult(resultUrl) {
    this.innerHTML = `
      <div class="aig-result">
        ${this.renderOptionsHtml()}
        <div class="aig-frame-wrap">
          <img src="${resultUrl}" alt="Your personalized artwork" draggable="false" />
        </div>
      </div>
    `;

    // Not real protection (anyone can still get the file via devtools
    // or by inspecting network requests), just raises the bar against
    // a casual right-click/drag save before the customer has actually
    // paid for it.
    const resultImage = this.querySelector(".aig-result img");

    resultImage?.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );

    resultImage?.addEventListener("dragstart", (event) =>
      event.preventDefault(),
    );

    this.wireOptionChips();
    this.updateFramePreview();
    this.updatePriceSummary();
  }

  // Rendered below the result image — one group per Product option
  // that has any choices at all, always shown (a customer can preview
  // any option, including Mat color, before committing to a frame).
  renderOptionsHtml() {
    const groups = this.options.filter((option) => option.choices.length > 0);

    if (groups.length === 0) {
      return "";
    }

    const groupsHtml = groups.map((option) => this.renderOptionGroupHtml(option)).join("");

    // Shown whenever there's at least one option to choose from — even
    // one currently priced at $0 — so the total is visible from the
    // start and stays visible as selections (and the price) change.
    const priceSummaryHtml = `
      <div class="aig-price-summary">
        <span>Total</span>
        <span class="aig-price-total" data-aig-price-total></span>
      </div>
    `;

    // Swatch box size and label font size are global to the whole
    // Style, so they're set once here (inherited by every descendant
    // chip/swatch below via CSS custom property inheritance) rather
    // than recomputed and duplicated on each individual chip.
    const styleVars = cssVars({
      "--aig-swatch-w": pxOrNull(this.swatchWidthPx),
      "--aig-swatch-h": pxOrNull(this.swatchHeightPx),
      "--aig-swatch-font": pxOrNull(this.swatchFontSizePx),
      "--aig-swatch-w-mobile": pxOrNull(this.swatchWidthMobilePx),
      "--aig-swatch-h-mobile": pxOrNull(this.swatchHeightMobilePx),
      "--aig-swatch-font-mobile": pxOrNull(this.swatchFontSizeMobilePx),
      "--aig-chip-gap": pxOrNull(this.swatchGapPx),
      "--aig-chip-border": this.swatchBorderColor || null,
      "--aig-chip-border-active": this.swatchActiveBorderColor || null,
    });

    const fullBleedClass = this.swatchFullBleed ? " aig-options--full-bleed" : "";

    return `<div class="aig-options${fullBleedClass}" ${styleVars ? `style="${styleVars}"` : ""}>${groupsHtml}${priceSummaryHtml}</div>`;
  }

  renderOptionGroupHtml(option) {
    const chipsHtml = option.choices
      .map((choice) => this.renderChoiceChipHtml(option, choice))
      .join("");

    return `
      <div
        class="aig-option-group"
        data-aig-option-group="${escapeHtml(option.id)}"
      >
        <span class="aig-mat-picker-label">${escapeHtml(option.label)}</span>
        <div class="aig-choice-chip-group">${chipsHtml}</div>
      </div>
    `;
  }

  renderChoiceChipHtml(option, choice) {
    const selected = this.selectedChoices[option.id] === choice.id;

    const priceHtml = choicePriceHtml(choice);

    // A choice's own uploaded image (any option, any type) takes
    // priority as the chip's swatch; a Color swatch option without an
    // image falls back to its flat hex color, or an empty ring for "no
    // color" (e.g. a Framing "No Frame" choice).
    let swatchHtml = "";

    const fullBleed = this.swatchFullBleed && Boolean(choice.imageUrl);

    if (choice.imageUrl) {
      const orientationClass =
        option.imageOrientation === "VERTICAL"
          ? "aig-choice-chip-swatch--vertical"
          : "aig-choice-chip-swatch--horizontal";

      const backgroundSize = option.imageFit === "ORIGINAL" ? "contain" : "cover";

      const fullBleedClass = fullBleed ? " aig-choice-chip-swatch--full-bleed" : "";

      swatchHtml = `<span class="aig-choice-chip-swatch aig-choice-chip-swatch--image ${orientationClass}${fullBleedClass}" style="background-image:url('${choice.imageUrl}');background-size:${backgroundSize}"></span>`;
    } else if (option.type === "COLOR_SWATCH") {
      swatchHtml = choice.hexColor
        ? `<span class="aig-choice-chip-swatch" style="background:${escapeHtml(choice.hexColor)}"></span>`
        : `<span class="aig-choice-chip-swatch aig-choice-chip-swatch--none"></span>`;
    }

    return `
      <button
        type="button"
        class="aig-choice-chip${fullBleed ? " aig-choice-chip--full-bleed" : ""}"
        data-aig-option="${escapeHtml(option.id)}"
        data-aig-choice="${escapeHtml(choice.id)}"
        aria-pressed="${selected}"
      >
        ${swatchHtml}
        <span class="aig-choice-chip-label">${escapeHtml(choice.label)}</span>
        ${priceHtml ? `<span class="aig-choice-chip-price">${priceHtml}</span>` : ""}
      </button>
    `;
  }

  wireOptionChips() {
    this.querySelectorAll("[data-aig-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const optionId = button.dataset.aigOption;

        this.selectedChoices[optionId] = button.dataset.aigChoice;

        this.querySelectorAll(
          `[data-aig-option="${CSS.escape(optionId)}"]`,
        ).forEach((other) => {
          other.setAttribute("aria-pressed", String(other === button));
        });

        this.updateFramePreview();
        this.updatePriceSummary();
      });
    });
  }

  updatePriceSummary() {
    const total = this.querySelector("[data-aig-price-total]");

    if (total) {
      total.textContent = formatMoney(this.computeTotal());
    }
  }

  // Resolves the currently-selected Framing choice and draws (or
  // clears) the CSS border + mat ring around the result image
  // accordingly — a Framing choice only carries a hexColor/imageUrl
  // when it's an actual physical frame (e.g. not a "No
  // Frame" row), so this naturally shows the frame/mat only when a
  // real framed choice is selected. Safe to call any time — a no-op
  // before a result exists.
  updateFramePreview() {
    const wrap = this.querySelector(".aig-frame-wrap");

    if (!wrap) {
      return;
    }

    const framingChoice = this.selectedFramingChoice();

    const isFramed = Boolean(
      framingChoice?.hexColor || framingChoice?.imageUrl,
    );

    wrap.classList.remove("aig-framed", "aig-framed-image");
    wrap.style.removeProperty("--aig-frame-color");
    wrap.style.removeProperty("--aig-frame-image");
    wrap.style.removeProperty("--aig-frame-thickness");
    wrap.style.removeProperty("--aig-mat-thickness");
    wrap.style.removeProperty("--aig-frame-radius");
    wrap.style.removeProperty("--aig-mat-color");
    wrap.style.removeProperty("--aig-mat-image");

    if (!isFramed) {
      return;
    }

    // Per-choice overrides of the CSS's own defaults — meaningful for
    // either frame type (flat color or uploaded texture), null means
    // "use the default."
    if (framingChoice.borderThicknessPx) {
      wrap.style.setProperty(
        "--aig-frame-thickness",
        `${framingChoice.borderThicknessPx}px`,
      );
    }

    if (framingChoice.matThicknessPx) {
      wrap.style.setProperty(
        "--aig-mat-thickness",
        `${framingChoice.matThicknessPx}px`,
      );
    }

    if (framingChoice.borderRadiusPx !== null && framingChoice.borderRadiusPx !== undefined) {
      wrap.style.setProperty("--aig-frame-radius", `${framingChoice.borderRadiusPx}px`);
    }

    // The frame border itself: an uploaded texture (tiled/repeated via
    // border-image's own "round" keyword) takes priority over a flat
    // color when the Framing choice carries both.
    if (framingChoice.imageUrl) {
      wrap.style.setProperty(
        "--aig-frame-image",
        `url("${framingChoice.imageUrl}")`,
      );
      wrap.classList.add("aig-framed-image");
    } else {
      wrap.style.setProperty("--aig-frame-color", framingChoice.hexColor);
      wrap.classList.add("aig-framed");
    }

    // The mat — independent of how the frame border itself renders
    // (flat color or texture). Its own uploaded image, tiled as a
    // repeating background, takes priority over its flat color the
    // same way the frame's does.
    const matChoice = this.selectedMatColorChoice();

    if (matChoice?.imageUrl) {
      wrap.style.setProperty("--aig-mat-image", `url("${matChoice.imageUrl}")`);
    } else if (matChoice?.hexColor) {
      wrap.style.setProperty("--aig-mat-color", matChoice.hexColor);
    }
  }
}

function pxOrNull(value) {
  return typeof value === "number" ? `${value}px` : null;
}

// Renders only the entries whose value isn't null, as a plain inline
// style string — an unset entry means "use the CSS default," so it's
// left out entirely rather than written as an empty value.
function cssVars(vars) {
  return Object.entries(vars)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}

function formatMoney(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return "";
  }

  return `$${num.toFixed(2)}`;
}

function formatDelta(value) {
  const num = Number(value);

  if (!Number.isFinite(num) || Math.abs(num) < 0.005) {
    return "";
  }

  const sign = num > 0 ? "+" : "−";

  return `${sign}$${Math.abs(num).toFixed(2)}`;
}

// Only role: VARIANT choices carry a priceDelta at all — role: EXTRA
// (e.g. Mat color) never shows a price. The one axisRole SIZE option's
// priceDelta is each size's own absolute price (not an increment, the
// same convention the admin editor and the Cart Transform Function's
// own pricing both use); every other priced option's priceDelta is a
// delta on top of that.
// A choice's priceDelta (null = no charge) is always a delta on top
// of the base price — there's no "absolute price" axis, even for
// Size.
function choicePriceHtml(choice) {
  if (choice.priceDelta === null) {
    return "";
  }

  const deltaText = formatDelta(choice.priceDelta);

  if (!deltaText) {
    return "";
  }

  const compareAt = choice.compareAtPriceDelta;

  if (compareAt !== null && Number(compareAt) !== Number(choice.priceDelta)) {
    const compareText = formatDelta(compareAt);

    if (compareText) {
      return `<s class="aig-choice-chip-compare">${compareText}</s> ${deltaText}`;
    }
  }

  return deltaText;
}

function renderImageField(field) {
  return `
    <div class="aig-field">
      <label class="aig-label">
        ${escapeHtml(field.label)}${field.required ? '<span class="aig-required"> *</span>' : ""}
      </label>
      <div class="aig-file-upload">
        <input
          type="file"
          class="aig-file-input"
          accept="image/png,image/jpeg,image/webp"
          data-aig-file-input="${field.id}"
        />
        <div
          class="aig-dropzone"
          data-aig-dropzone="${field.id}"
          tabindex="0"
          role="button"
        ></div>
      </div>
      ${field.helpText ? `<p class="aig-help">${escapeHtml(field.helpText)}</p>` : ""}
      <div class="aig-personalize" data-aig-personalize="${field.id}" hidden>
        <label class="aig-label" for="aig-personalize-input-${field.id}">Personalize (optional)</label>
        <input
          type="text"
          class="aig-control"
          id="aig-personalize-input-${field.id}"
          name="personalization"
          placeholder="Anything else you'd like to add? e.g. add a crown"
          maxlength="200"
        />
      </div>
    </div>
  `;
}

// SVG icon markup matches the file-upload design already shipped in
// this shop's Product Options app, for a consistent look across both.
const UPLOAD_CLOUD_ICON =
  '<svg class="aig-dropzone-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V8M12 8l-3.5 3.5M12 8l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 18a4 4 0 0 1-.7-7.94 5 5 0 0 1 9.53-2A4.5 4.5 0 0 1 17 18H7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const FILE_ICON =
  '<svg class="aig-dropzone-file-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5h7l3.5 3.5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

function renderEmptyDropzone(dropzone) {
  dropzone.classList.remove("aig-dropzone--filled");
  dropzone.setAttribute("aria-label", "Upload a photo");

  dropzone.innerHTML = `
    ${UPLOAD_CLOUD_ICON}
    <strong>Drag and drop</strong>
    <span>or browse files</span>
    <button type="button" class="aig-dropzone-browse">Browse</button>
  `;

  const browseButton = dropzone.querySelector(".aig-dropzone-browse");

  browseButton?.addEventListener("click", (event) => {
    event.stopPropagation();

    dropzone.click();
  });
}

function renderFilledDropzone(dropzone, file, onClear) {
  dropzone.classList.add("aig-dropzone--filled");
  dropzone.setAttribute(
    "aria-label",
    `Selected file ${file.name}. Click or drop a file to change it.`,
  );

  dropzone.innerHTML = `
    ${FILE_ICON}
    <span class="aig-dropzone-filename">${escapeHtml(file.name)}</span>
    <button type="button" class="aig-dropzone-clear" aria-label="Remove file">&times;</button>
  `;

  const clearButton = dropzone.querySelector(".aig-dropzone-clear");

  clearButton?.addEventListener("click", (event) => {
    event.stopPropagation();

    onClear();
  });
}

function renderField(field) {
  const requiredMark = field.required
    ? '<span class="aig-required"> *</span>'
    : "";

  const name = `field_${field.id}`;

  const helpHtml = field.helpText
    ? `<p class="aig-help">${escapeHtml(field.helpText)}</p>`
    : "";

  let controlHtml;

  switch (field.type) {
    case "TEXTAREA":
      controlHtml = `<textarea class="aig-control" name="${name}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(field.defaultValue || "")}</textarea>`;

      break;

    case "SELECT": {
      const options = (field.options || [])
        .map(
          (option) =>
            `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`,
        )
        .join("");

      controlHtml = `<select class="aig-control" name="${name}"><option value="">${escapeHtml(field.placeholder || "Choose an option")}</option>${options}</select>`;

      break;
    }

    case "TOGGLE":
      return `
        <div class="aig-field">
          <label class="aig-checkbox-row">
            <input type="checkbox" name="${name}" />
            ${escapeHtml(field.label)}${requiredMark}
          </label>
          ${helpHtml}
        </div>
      `;

    case "NUMBER":
      controlHtml = `<input class="aig-control" type="number" name="${name}" placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(field.defaultValue || "")}" />`;

      break;

    case "DATE":
      controlHtml = `<input class="aig-control" type="date" name="${name}" value="${escapeHtml(field.defaultValue || "")}" />`;

      break;

    default:
      controlHtml = `<input class="aig-control" type="text" name="${name}" placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(field.defaultValue || "")}" />`;
  }

  return `
    <div class="aig-field">
      <label class="aig-label">${escapeHtml(field.label)}${requiredMark}</label>
      ${controlHtml}
      ${helpHtml}
    </div>
  `;
}

// Locates the theme's own native product-add-to-cart form — same
// lookup order as this shop's Product Options app: prefer the form
// within this block's own section, then any form in an ancestor
// <section>, then fall back to the first one on the page.
function findProductForm(root) {
  const sectionScope = root.closest(".shopify-section");

  const local =
    sectionScope && sectionScope.querySelector('form[action*="/cart/add"]');

  if (local) {
    return local;
  }

  const section = sectionScope || root.closest("section");

  const fallback =
    section && section.querySelector('form[action*="/cart/add"]');

  if (fallback) {
    return fallback;
  }

  return document.querySelector('form[action*="/cart/add"]');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

if (!customElements.get("ai-art-generator")) {
  customElements.define("ai-art-generator", AiArtGenerator);
}
