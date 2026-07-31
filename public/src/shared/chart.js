export function destroyChart(chart) {
  if (chart) chart.destroy();
  return null;
}

export function createChart(Chart, target, config) {
  return new Chart(target, config);
}
