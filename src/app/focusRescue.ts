/**
 * Keeps keyboard and screen reader users in place when an action removes the
 * control they used (a button that disappears once its job is done, a row
 * that is removed, a form that closes, a card that is rebuilt).
 *
 * Browsers then drop focus to `<body>`, so the next Tab starts from the top of
 * the page. Instead, focus moves to the heading of the section the control was
 * in, found again by its text after the change, or to the page's h1.
 * Handlers that move focus themselves win: this only acts when focus is lost.
 */

const SECTION_HEADINGS = 'h2, h3, h4';

/** The last section heading before `element` in document order, outside dialogs. */
function headingBefore(root: HTMLElement, element: Element): HTMLElement | null {
  // A control inside a dialog belongs to the place the dialog was opened from.
  const anchor = element.closest('dialog') ?? element;
  let found: HTMLElement | null = null;
  for (const heading of root.querySelectorAll<HTMLElement>(SECTION_HEADINGS)) {
    if (heading.closest('dialog')) continue;
    if (heading === anchor || anchor.contains(heading)) break;
    if (heading.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) {
      found = heading;
    } else {
      break;
    }
  }
  return found;
}

function focusHeading(heading: HTMLElement) {
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
}

/** Starts watching `root` (the page's main element). Returns the cleanup. */
export function watchLostFocus(root: HTMLElement): () => void {
  let last: {
    element: HTMLElement;
    heading: HTMLElement | null;
    text: string | null;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const rememberElement = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement) || target === root || !root.contains(target))
      return;
    const heading = headingBefore(root, target);
    last = { element: target, heading, text: heading?.textContent ?? null };
  };
  const remember = (event: FocusEvent) => {
    rememberElement(event.target);
  };

  const rescue = () => {
    timer = null;
    if (!last || last.element.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const { heading, text } = last;
    last = null;
    // The same heading if it is still there, else one with the same text (a rebuilt card).
    const same = heading?.isConnected
      ? heading
      : text
        ? [...root.querySelectorAll<HTMLElement>(SECTION_HEADINGS)].find(
            (h) => !h.closest('dialog') && h.textContent === text,
          )
        : undefined;
    const target = same ?? root.querySelector<HTMLElement>('h1');
    if (target) focusHeading(target);
    else root.focus();
  };

  // Check after the click or key press has been handled and React has committed.
  const schedule = (event: Event) => {
    // Also note the control here: focus events do not fire while the window
    // itself is not focused, but the click or key press still reaches it.
    const active = document.activeElement;
    rememberElement(active && active !== document.body ? active : event.target);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(rescue, 0);
  };

  // A form submitted with problems: take the reader to the first invalid field,
  // unless the form's own handler has already moved focus somewhere.
  const checkSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const from = document.activeElement;
    setTimeout(() => {
      const now = document.activeElement;
      if (!form.isConnected || (now !== from && now !== document.body)) return;
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }, 0);
  };

  root.addEventListener('submit', checkSubmit);
  root.addEventListener('focusin', remember);
  document.addEventListener('click', schedule, true);
  document.addEventListener('keydown', schedule, true);
  document.addEventListener('close', schedule, true);
  return () => {
    root.removeEventListener('submit', checkSubmit);
    root.removeEventListener('focusin', remember);
    document.removeEventListener('click', schedule, true);
    document.removeEventListener('keydown', schedule, true);
    document.removeEventListener('close', schedule, true);
    if (timer !== null) clearTimeout(timer);
  };
}
