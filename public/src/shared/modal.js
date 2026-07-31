export function mountModal(modal, initialFocusSelector) {
  const previousFocus = document.activeElement;
  const dialog = modal.querySelector('[role="dialog"]');
  const focusableSelector = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const close = () => {
    document.removeEventListener('keydown', handleKeydown);
    modal.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  };

  const handleKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;

    const focusable = [...dialog.querySelectorAll(focusableSelector)];
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.body.appendChild(modal);
  document.addEventListener('keydown', handleKeydown);
  queueMicrotask(() => {
    const initialFocus = initialFocusSelector
      ? dialog?.querySelector(initialFocusSelector)
      : dialog?.querySelector(focusableSelector);
    (initialFocus || dialog)?.focus();
  });
  return close;
}
