// Shared "something's wrong with your form" feedback helper.
//
// react-hook-form's handleSubmit swallows invalid submissions and only
// writes to `formState.errors` — nothing on screen changes, and if the
// invalid field isn't currently scrolled into view (common on long
// forms and wizards), the submit button looks broken. This helper
// stitches four pieces of feedback together whenever `handleSubmit`'s
// onInvalid callback fires:
//
//   1. Toast the first leaf error (with its path prepended so the
//      message reads "sites.0.site_id: Invalid uuid" instead of just
//      "Invalid uuid").
//   2. Call RHF's `setFocus(path)` — scrolls the input into view AND
//      focuses it (the browser handles the scroll-into-view).
//   3. Shake the field for ~320 ms via the `.animate-form-shake` class
//      (keyframes in app/globals.css). Short, non-layout-shifting.
//   4. For a wizard, jump the user back to the step that owns the
//      field. Callers pass `stepByFieldRoot` + `setStep` to opt in.
//
// Also logs the full error tree to `console.warn` so future "submit
// does nothing" reports always have a breadcrumb trail in devtools.
//
// Typical usage inside a client component:
//
//   function onInvalid(errors: FieldErrors<MyForm>) {
//     showFirstFormError(errors, { setFocus, label: "MyForm" });
//   }
//   <form onSubmit={handleSubmit(onSubmit, onInvalid)} …>

import { toast } from "sonner";
import type { FieldErrors, UseFormSetFocus, FieldValues } from "react-hook-form";

export interface ShowFirstFormErrorOptions<T extends FieldValues> {
  // RHF's `setFocus` — when provided, we scroll + focus the field. Pass
  // from `useForm<T>()` destructure.
  setFocus?: UseFormSetFocus<T>;
  // Wizard integration. `stepByFieldRoot` maps a top-level field
  // name to the wizard step index that renders it. `setStep` is the
  // local state setter. When both are set and the current step !==
  // target, the wizard jumps back so the inline error is actually on
  // screen before the shake fires.
  stepByFieldRoot?: Record<string, number>;
  currentStep?: number;
  setStep?: (next: number) => void;
  // Shown as a breadcrumb prefix in console.warn, e.g. "CampaignForm".
  // Useful when several forms share a page.
  label?: string;
  // Override toast text (rare — the default "<path>: <message>" is
  // usually the clearest thing we can show).
  toastMessage?: string;
}

interface Leaf {
  path: string;
  message: string;
  rootKey: string;
}

export function showFirstFormError<T extends FieldValues>(
  errors: FieldErrors<T>,
  options: ShowFirstFormErrorOptions<T> = {},
): Leaf | null {
  const {
    setFocus,
    stepByFieldRoot,
    currentStep,
    setStep,
    label,
    toastMessage,
  } = options;

  if (label) {
    console.warn(`[${label}] submit blocked by validation:`, errors);
  } else {
    console.warn("[form] submit blocked by validation:", errors);
  }

  const leaf = findFirstLeaf(errors);

  if (!leaf) {
    toast.error(toastMessage ?? "Please fix the highlighted fields before continuing.");
    return null;
  }

  // Wizard jump — flip the step BEFORE firing focus so the field has
  // actually mounted before the scroll kicks in.
  if (stepByFieldRoot && setStep) {
    const target = stepByFieldRoot[leaf.rootKey];
    if (typeof target === "number" && target !== currentStep) {
      setStep(target);
    }
  }

  const pretty =
    toastMessage ??
    (leaf.message ? `${leaf.path}: ${leaf.message}` : "Please fix the highlighted fields.");
  toast.error(pretty);

  // RAF so the step switch above gets a chance to render first. Then
  // focus + shake. The focus call scrolls the input into view (modern
  // browsers do this on `.focus()` by default for off-screen elements).
  if (typeof window !== "undefined") {
    requestAnimationFrame(() => {
      if (setFocus) {
        try {
          setFocus(leaf.path as never, { shouldSelect: true });
        } catch {
          // RHF throws if the field isn't registered (e.g. array-level
          // error on a path with no direct <input>). Swallow — the toast
          // is still the primary signal.
        }
      }
      shakeField(leaf.path);
    });
  }

  return leaf;
}

// Attach an animation class to the field (and its wrapper, so inputs
// inside styled Shadcn Form groups still shake). Finds elements by
// `name=…` — RHF registers that attribute on every registered input.
export function shakeField(path: string): void {
  if (typeof document === "undefined") return;
  // Escape for querySelector — field paths can contain brackets/dots
  // (`sites.0.site_id`). CSS.escape handles the special characters.
  const selector = `[name="${CSS.escape(path)}"]`;
  const nodes = document.querySelectorAll<HTMLElement>(selector);
  if (nodes.length === 0) return;
  nodes.forEach((el) => {
    // Shake the closest form-group wrapper when there is one; falls
    // back to the element itself. Keeps the shake visible even when
    // the input is deeply nested.
    const target: HTMLElement =
      el.closest("[data-form-field]") ?? el.parentElement ?? el;
    target.classList.remove("animate-form-shake");
    // Force a reflow so re-adding the class triggers the keyframe
    // animation again when the same field errors twice in a row.
    void target.offsetWidth;
    target.classList.add("animate-form-shake");
    // Clean up after the animation so the class doesn't accumulate
    // on repeated submits.
    window.setTimeout(() => {
      target.classList.remove("animate-form-shake");
    }, 360);
  });
}

// Depth-first walk through RHF's errors object. Returns the first
// subtree carrying a non-empty `message`. Path uses dot + numeric-index
// notation (`sites.0.site_id`) which matches RHF's own expectations
// for `setFocus`. Skips RHF's internal `ref` / `type` keys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFirstLeaf(obj: any, prefix = ""): Leaf | null {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.message === "string" && obj.message.length > 0) {
    const path = prefix || "root";
    return { path, message: obj.message, rootKey: path.split(/[.[]/)[0] };
  }
  for (const key of Object.keys(obj)) {
    if (key === "ref" || key === "type" || key === "types") continue;
    const child = obj[key];
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const hit = findFirstLeaf(child, nextPrefix);
    if (hit) return hit;
  }
  return null;
}
