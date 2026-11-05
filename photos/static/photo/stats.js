/* Photos > Statistics: upload history and activity charts (Chart.js). */
document.addEventListener("DOMContentLoaded", function() {
    // Chart data comes from json_script tags rendered by stats.html (id "st-<name>").
    function read(name) {
        return JSON.parse(document.getElementById('st-' + name).textContent);
    }
    function series(prefix) {
        return {
            labels: read(prefix + '_labels'),
            all: read(prefix + '_data_all'),
            photo: read(prefix + '_data_photo'),
            video: read(prefix + '_data_video'),
            video_duration: read(prefix + '_data_video_duration')
        };
    }

    // Datasets for the dynamic history-chart ranges and media types
    const datasets = {
        '12m': series('months_12'),
        '24m': series('months_24'),
        '5y': series('months_60'),
        '10y': series('years_10'),
        'all': series('all_years')
    };
    const hourlyDataset = series('hours');
    const dailyDataset = series('days');
    const monthlyDataset = series('months_year');

    // ---- Theme-aware colours: read the app tokens at render time ----
    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    function withAlpha(color, alpha) {
        const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
        if (!m) return color;
        let hex = m[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    // Colour follows the selected media type, the same in every chart.
    const seriesVar = { all: '--app-accent', photo: '--ins-photo', video: '--ins-video', video_duration: '--ins-orig' };
    function seriesColor(mediaType) {
        return cssVar(seriesVar[mediaType] || '--app-accent') || '#0f6d77';
    }
    function themeColors() {
        return {
            text: cssVar('--app-muted'),
            grid: withAlpha(cssVar('--app-border'), 0.9),
            surface: cssVar('--app-surface'),
            fg: cssVar('--app-fg'),
            border: cssVar('--app-border'),
        };
    }

    Chart.defaults.font.family = cssVar('--app-font') || 'system-ui, sans-serif';

    function baseOptions() {
        const t = themeColors();
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: t.surface,
                    titleColor: t.fg,
                    bodyColor: t.fg,
                    borderColor: t.border,
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { color: t.border },
                    ticks: { color: t.text, maxRotation: 0, autoSkipPadding: 8 }
                },
                y: {
                    grid: { color: t.grid },
                    border: { display: false },
                    ticks: { color: t.text, precision: 0 }
                }
            }
        };
    }
    function applyThemeToOptions(chart) {
        const t = themeColors();
        const o = chart.options;
        o.plugins.tooltip.backgroundColor = t.surface;
        o.plugins.tooltip.titleColor = t.fg;
        o.plugins.tooltip.bodyColor = t.fg;
        o.plugins.tooltip.borderColor = t.border;
        o.scales.x.border.color = t.border;
        o.scales.x.ticks.color = t.text;
        o.scales.y.grid.color = t.grid;
        o.scales.y.ticks.color = t.text;
    }

    // Paint a bar or line dataset in the colour of its media type.
    function paintDataset(chart, mediaType) {
        const ds = chart.data.datasets[0];
        const c = seriesColor(mediaType);
        if (chart.config.type === 'line') {
            ds.borderColor = c;
            ds.backgroundColor = withAlpha(c, 0.14);
            ds.pointBackgroundColor = c;
            ds.pointBorderColor = cssVar('--app-surface');
        } else {
            ds.backgroundColor = c;
            ds.hoverBackgroundColor = withAlpha(c, 0.8);
            ds.borderColor = c;
        }
    }

    function barDataset(label, data) {
        return { label: label, data: data, borderWidth: 0, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 40 };
    }

    // 1. History Chart
    const monthCtx = document.getElementById('monthChart').getContext('2d');
    const historyChart = new Chart(monthCtx, {
        type: 'bar',
        data: {
            labels: datasets['12m'].labels,
            datasets: [barDataset('Items Uploaded', datasets['12m'].all)]
        },
        options: baseOptions()
    });
    paintDataset(historyChart, 'all');
    historyChart.update();

    // Toggle History Chart range/media type dynamically
    function updateHistoryChart() {
        const range = document.getElementById('chartRangeSelect').value;
        const mediaType = document.getElementById('chartTypeSelect').value;
        const dataObj = datasets[range];

        historyChart.data.labels = dataObj.labels;
        historyChart.data.datasets[0].data = dataObj[mediaType];
        historyChart.data.datasets[0].label = mediaType === 'video_duration' ? 'Minutes' : 'Items Uploaded';
        paintDataset(historyChart, mediaType);

        historyChart.update();
    }

    document.getElementById('chartRangeSelect').addEventListener('change', updateHistoryChart);
    document.getElementById('chartTypeSelect').addEventListener('change', updateHistoryChart);

    // 2. Hourly Activity Chart
    const hourCtx = document.getElementById('hourChart').getContext('2d');
    const hourChart = new Chart(hourCtx, {
        type: 'line',
        data: {
            labels: hourlyDataset.labels,
            datasets: [{
                label: 'Captures',
                data: hourlyDataset.all,
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBorderWidth: 2
            }]
        },
        options: baseOptions()
    });
    paintDataset(hourChart, 'all');
    hourChart.update();

    // Toggle Hourly Activity media type dynamically
    document.getElementById('hourTypeSelect').addEventListener('change', function() {
        const mediaType = this.value;
        hourChart.data.datasets[0].data = hourlyDataset[mediaType];
        hourChart.data.datasets[0].label = mediaType === 'video_duration' ? 'Minutes' : 'Captures';
        paintDataset(hourChart, mediaType);
        hourChart.update();
    });

    // 3. Daily Activity Chart (Bar Chart)
    const dayCtx = document.getElementById('dayChart').getContext('2d');
    const dayChart = new Chart(dayCtx, {
        type: 'bar',
        data: {
            labels: dailyDataset.labels,
            datasets: [barDataset('Captures', dailyDataset.all)]
        },
        options: baseOptions()
    });
    paintDataset(dayChart, 'all');
    dayChart.update();

    // Toggle Daily Activity media type dynamically
    document.getElementById('dayTypeSelect').addEventListener('change', function() {
        const mediaType = this.value;
        dayChart.data.datasets[0].data = dailyDataset[mediaType];
        dayChart.data.datasets[0].label = mediaType === 'video_duration' ? 'Minutes' : 'Captures';
        paintDataset(dayChart, mediaType);
        dayChart.update();
    });

    // 4. Monthly Activity Chart (Bar Chart)
    const monthOfYearCtx = document.getElementById('monthOfYearChart').getContext('2d');
    const monthOfYearChart = new Chart(monthOfYearCtx, {
        type: 'bar',
        data: {
            labels: monthlyDataset.labels,
            datasets: [barDataset('Captures', monthlyDataset.all)]
        },
        options: baseOptions()
    });
    paintDataset(monthOfYearChart, 'all');
    monthOfYearChart.update();

    // Toggle Monthly Activity media type dynamically
    document.getElementById('monthTypeSelect').addEventListener('change', function() {
        const mediaType = this.value;
        monthOfYearChart.data.datasets[0].data = monthlyDataset[mediaType];
        monthOfYearChart.data.datasets[0].label = mediaType === 'video_duration' ? 'Minutes' : 'Captures';
        paintDataset(monthOfYearChart, mediaType);
        monthOfYearChart.update();
    });

    // Re-colour every chart when the theme changes (data-bs-theme on <html>).
    const chartTypeSelects = [
        [historyChart, 'chartTypeSelect'],
        [hourChart, 'hourTypeSelect'],
        [dayChart, 'dayTypeSelect'],
        [monthOfYearChart, 'monthTypeSelect'],
    ];
    new MutationObserver(function() {
        chartTypeSelects.forEach(function([chart, selectId]) {
            applyThemeToOptions(chart);
            paintDataset(chart, document.getElementById(selectId).value);
            chart.update();
        });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
});
