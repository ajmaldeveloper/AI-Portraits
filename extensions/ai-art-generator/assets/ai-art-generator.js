// Renders the customer-facing personalization form: fetches the
// Style's field definitions from the app proxy, lets the shopper
// upload a photo and fill in any other fields, submits it, and polls
// for the generated result. No framework — this ships straight to the
// storefront, so it stays dependency-free.

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

    // { variantId, label, scalePercent }[] — from the app proxy, only
    // populated once the product's been published with the shop's
    // configured print sizes as real Shopify variants.
    this.sizeOptions = [];

    // Captured at submit time — the form's own inputs are gone by the
    // time the theme's native "Add to cart" is clicked, since a
    // finished generation replaces this element's whole contents with
    // just the result image.
    this.submittedFieldValues = {};
    this.submittedPersonalization = "";
    this.generationId = null;
    this.generationResultUrl = null;

    // { [sizeLabel]: signedUrl } — same generated image, one signed URL
    // per configured print size (the largest is the untouched original;
    // smaller ones are resized on read). Matched against whichever
    // variant the theme's native size picker has selected at
    // add-to-cart time.
    this.resultUrls = {};
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
  // attach the generation result and field answers as line item
  // properties, rather than building a separate cart request.
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

      const selectedVariantId = getSelectedVariantId(form);

      const matchedSize = this.sizeOptions.find(
        (option) => option.variantId === selectedVariantId,
      );

      const resultImageUrl =
        (matchedSize && this.resultUrls[matchedSize.label]) ||
        this.generationResultUrl;

      event.formData.set(
        "properties[_ai_art_generation_id]",
        this.generationId || "",
      );

      event.formData.set("properties[_ai_art_result_image]", resultImageUrl);

      if (matchedSize) {
        event.formData.set("properties[Print size]", matchedSize.label);
      }

      for (const [key, value] of Object.entries(this.submittedFieldValues)) {
        if (!value) {
          continue;
        }

        const field = this.fields.find((item) => item.key === key);

        const label = field ? field.label : key;

        event.formData.set(`properties[${label}]`, value);
      }

      if (this.submittedPersonalization) {
        event.formData.set(
          "properties[Personalization]",
          this.submittedPersonalization,
        );
      }
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
      this.sizeOptions = payload.sizeOptions || [];

      this.renderForm();
    } catch {
      this.renderError("Could not load the personalization form.");
    }
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

    this.innerHTML = `
      ${headingHtml}
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

  renderStatus(message) {
    this.innerHTML = `
      <div class="aig-spinner" role="status"></div>
      <p class="aig-status-text">${escapeHtml(message)}</p>
    `;
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
          this.resultUrls = payload.resultUrls || {};

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
        <img src="${resultUrl}" alt="Your personalized artwork" />
        <p class="aig-status-text">Ready — add to cart below to order this.</p>
      </div>
    `;
  }
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

// Shopify's own theme templates render the variant/size picker as a
// control named "id" inside the cart-add form (a <select> or a hidden
// input the theme's variant-picker JS updates) — this app never
// renders its own size picker, it just reads whatever the theme's
// native one currently has selected.
function getSelectedVariantId(form) {
  const control = form.querySelector('[name="id"]');

  return control ? String(control.value) : null;
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
