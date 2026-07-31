export function installReports(ctx) {
  const {
    $, main, fmt, monthName, renderPageHeader, renderSectionHeader,
    renderCurrency, renderEmptyState, api, pages, esc, Chart, createChart,
    destroyChart,
  } = ctx;
let reportChart = null;

pages.reports = async function (year, month) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const prevDate = new Date(year, month - 2, 1);
  const prevYear = prevDate.getFullYear(), prevMonth = prevDate.getMonth() + 1;

  main().innerHTML = `
    <div class="ui-page reports-page">
      ${renderPageHeader({
        title: 'Reports',
        subtitle: 'Understand your income, spending and category trends.',
        className: 'reports-page-header',
      })}
      <div class="ui-loading-placeholder reports-loading" role="status" aria-live="polite">
        <span class="ui-loading-placeholder__bar ui-loading-placeholder__bar--wide" aria-hidden="true"></span>
        <span class="ui-loading-placeholder__bar" aria-hidden="true"></span>
        Loading report…
      </div>
    </div>`;

  const [curr, prev] = await Promise.all([
    api(`/summary/${year}/${month}`),
    api(`/summary/${prevYear}/${prevMonth}`),
  ]);

  const catData = curr.byCategory.filter(c => c.total > 0);
  const topCategories = catData.slice(0, 6);
  const comparisonRows = curr.byCategory.filter(c => {
    const previous = prev.byCategory.find(item => item.name === c.name);
    return c.total > 0 || (previous && previous.total > 0);
  });
  const remainingClass = curr.remaining < 0 ? 'reports-kpi-negative' : 'reports-kpi-positive';
  const monthNav = `
    <div class="month-nav ui-action-bar reports-month-nav" aria-label="Report month">
      <button class="btn btn-ghost btn-sm" id="repPrev" aria-label="Previous month">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="repNext" aria-label="Next month">▶</button>
    </div>`;

  main().innerHTML = `
    <div class="ui-page reports-page">
      ${renderPageHeader({
        title: 'Reports',
        subtitle: 'Understand your income, spending and category trends.',
        actions: monthNav,
        className: 'reports-page-header',
      })}

      <section class="ui-responsive-grid ui-responsive-grid--three reports-kpi-grid" aria-label="Monthly report summary">
        <article class="stat-card ui-stat-card ui-summary-card reports-kpi-card reports-kpi-income">
          <span class="label">Income</span>
          <strong class="value">${renderCurrency(curr.income)}</strong>
          <span class="reports-kpi-caption">Received in ${monthName(month)}</span>
        </article>
        <article class="stat-card ui-stat-card ui-summary-card reports-kpi-card reports-kpi-spent">
          <span class="label">Spent</span>
          <strong class="value">${renderCurrency(curr.spent)}</strong>
          <span class="reports-kpi-caption">Recorded across all categories</span>
        </article>
        <article class="stat-card ui-stat-card ui-summary-card reports-kpi-card ${remainingClass}">
          <span class="label">Remaining</span>
          <strong class="value">${renderCurrency(curr.remaining)}</strong>
          <span class="reports-kpi-caption">Income minus recorded spending</span>
        </article>
      </section>

      <div class="ui-responsive-grid reports-analytics-grid">
        <section class="card ui-card reports-card reports-chart-card" aria-labelledby="reports-chart-title">
          ${renderSectionHeader({
            title: 'Spending by category',
            subtitle: `Recorded spending for ${monthName(month)} ${year}.`,
            id: 'reports-chart-title',
          })}
          ${catData.length ? `
            <div class="reports-chart-wrap">
              <canvas id="reportChart" role="img"
                aria-label="Horizontal bar chart of spending by category for ${monthName(month)} ${year}"></canvas>
            </div>` : renderEmptyState({
              title: 'No spending to chart',
              description: `Transactions added for ${monthName(month)} will appear here by category.`,
              icon: '▥',
              className: 'reports-chart-empty',
            })}
        </section>

        <section class="card ui-card reports-card reports-ranking-card" aria-labelledby="reports-ranking-title">
          ${renderSectionHeader({
            title: 'Top categories',
            subtitle: 'Your six highest spending categories this month.',
            id: 'reports-ranking-title',
          })}
          ${topCategories.length ? `
          <ol class="list reports-ranking-list">
            ${topCategories.map((c, i) => `
            <li class="list-item reports-ranking-item">
              <span class="reports-rank" aria-label="Rank ${i + 1}">${i + 1}</span>
              <span class="dot" style="background:${c.colour}"></span>
              <span class="desc">${esc(c.name)}</span>
              <span class="amount ui-currency">${fmt(c.total)}</span>
            </li>`).join('')}
          </ol>` : renderEmptyState({
            title: 'No categories to rank',
            description: `Category rankings will appear after spending is recorded for ${monthName(month)}.`,
            icon: '↗',
            className: 'reports-ranking-empty',
          })}
        </section>
      </div>

      <section class="card ui-card reports-card reports-comparison-card" aria-labelledby="reports-comparison-title">
        ${renderSectionHeader({
          title: 'Month comparison',
          subtitle: `${monthName(month)} compared with ${monthName(prevMonth)} by category.`,
          id: 'reports-comparison-title',
        })}
        ${comparisonRows.length ? `
        <div class="reports-table-scroll" tabindex="0" role="region" aria-label="Scrollable month comparison table">
          <table class="reports-table">
            <caption class="ui-sr-only">${monthName(month)} compared with ${monthName(prevMonth)} by spending category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">${monthName(prevMonth)}</th>
                <th scope="col">${monthName(month)}</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              ${comparisonRows.map(c => {
                const previous = prev.byCategory.find(item => item.name === c.name);
                const prevTotal = previous ? previous.total : 0;
                const diff = c.total - prevTotal;
                const changeClass = diff > 0 ? 'reports-change-up' : diff < 0 ? 'reports-change-down' : 'reports-change-flat';
                return `<tr>
                  <th scope="row">
                    <span class="dot" style="background:${c.colour}"></span>
                    <span>${esc(c.name)}</span>
                  </th>
                  <td class="reports-table-previous">${fmt(prevTotal)}</td>
                  <td>${fmt(c.total)}</td>
                  <td class="${changeClass}">${diff === 0 ? '—' : (diff > 0 ? '+' : '') + fmt(diff)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : renderEmptyState({
          title: 'Nothing to compare yet',
          description: `Add spending in ${monthName(prevMonth)} or ${monthName(month)} to build a month-over-month comparison.`,
          icon: '⇄',
          className: 'reports-comparison-empty',
        })}
      </section>
    </div>
  `;

  reportChart = destroyChart(reportChart);
  if (catData.length > 0) {
    reportChart = createChart(Chart, $('reportChart'), {
      type: 'bar',
      data: {
        labels: catData.map(c => c.name),
        datasets: [{ data: catData.map(c => c.total), backgroundColor: catData.map(c => c.colour), borderWidth: 0 }],
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#888', callback: v => '£'+v }, grid: { color: '#2a2a2a' } },
                  y: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } } } },
    });
  }

  $('repPrev').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.reports(d.getFullYear(), d.getMonth() + 1);
  });
  $('repNext').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.reports(d.getFullYear(), d.getMonth() + 1);
  });
};
}
