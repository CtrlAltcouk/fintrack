export function createFormHelpers() {
  async function submitForm(form, action) {
    if (!form || form.dataset.submitting === 'true') return false;
    form.dataset.submitting = 'true';
    const controls = form.matches?.('button, input[type="submit"]')
      ? [form]
      : [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    controls.forEach(control => { control.disabled = true; });
    try {
      await action();
      return true;
    } catch (error) {
      alert(error?.message || 'The request could not be completed.');
      return false;
    } finally {
      delete form.dataset.submitting;
      controls.forEach(control => { control.disabled = false; });
    }
  }
  return { submitForm };
}
