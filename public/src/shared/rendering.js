export function createRenderHelpers({ esc, fmt }) {
  function renderPageHeader({
    title,
    subtitle = '',
    actions = '',
    className = '',
    introClass = '',
    actionsClass = '',
  }) {
    return `
    <div class="page-header ui-page-header ${className}">
      <div class="ui-page-header__intro ${introClass}">
        <h1 class="page-title ui-page-header__title">${esc(title)}</h1>
        ${subtitle ? `<p class="ui-page-header__subtitle">${esc(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="page-header-actions ui-page-header__actions ${actionsClass}">${actions}</div>` : ''}
    </div>`;
  }

  function renderSectionHeader({ title, subtitle = '', id = '', actions = '' }) {
    return `
    <div class="ui-section-header">
      <div>
        <h2 class="ui-section-header__title"${id ? ` id="${esc(id)}"` : ''}>${esc(title)}</h2>
        ${subtitle ? `<p class="ui-section-header__subtitle">${esc(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="ui-section-header__actions">${actions}</div>` : ''}
    </div>`;
  }

  function renderCurrency(value, className = '') {
    return `<span class="ui-currency ${className}">${fmt(value)}</span>`;
  }

  function renderEmptyState({ title, description, action = '', icon = '↗', className = '' }) {
    return `
    <div class="ui-empty-state ${className}">
      <span class="ui-empty-state__icon" aria-hidden="true">${icon}</span>
      <h2 class="ui-empty-state__title">${esc(title)}</h2>
      <p class="ui-empty-state__description">${esc(description)}</p>
      ${action}
    </div>`;
  }

  return { renderPageHeader, renderSectionHeader, renderCurrency, renderEmptyState };
}
