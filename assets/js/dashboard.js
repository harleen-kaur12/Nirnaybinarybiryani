document.addEventListener('DOMContentLoaded', () => {
    console.log("Dashboard JS loaded.");
    // Chart.js configuration
    Chart.defaults.font.family = "'DM Sans', sans-serif";
    Chart.defaults.color = '#6B7A99';

    const CHART_COLORS = {
        red: 'rgb(192, 57, 43)',
        green: 'rgb(13, 122, 78)',
        amber: 'rgb(212, 136, 14)',
        blue: 'rgb(37, 99, 235)',
        slate: 'rgb(107, 122, 153)',
        mist: 'rgb(245, 246, 250)'
    };

    let trendChartInstance = null;
    let sentimentDonutInstance = null;

    async function fetchAIReport() {
        const urlParams = new URLSearchParams(window.location.search);
        const sourceId = urlParams.get('sourceId');

        try {
            // If a sourceId is present, we might need to generate the report first.
            if (sourceId) {
                await generateAIReport(sourceId);
            }

            const response = await fetch('/api/ai/report');
            if (!response.ok) {
                if (response.status === 404) {
                    showGenerateReportUI(sourceId);
                } else {
                    throw new Error(`Server error: ${response.statusText}`);
                }
                return;
            }
            const report = await response.json();
            updateDashboard(report);
        } catch (error) {
            console.error('Failed to fetch AI report:', error);
            showErrorState(error.message);
        }
    }

    async function generateAIReport(sourceId = null) {
        const btn = document.getElementById('generate-report-btn');
        const originalText = btn ? btn.innerHTML : 'Generate AI Report';
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner"></span> Generating...`;
        }

        try {
            const body = sourceId ? JSON.stringify({ sourceId }) : JSON.stringify({});
            const response = await fetch('/api/ai/generate-report', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.details || `Failed to generate report: ${response.statusText}`);
            }
            
            // After generating, reload the page to show the new report.
            // The sourceId will be gone from the URL, and the generic /api/ai/report will be fetched.
            window.location.href = 'dashboard.html';

        } catch (error) {
            console.error('Error generating AI report:', error);
            showErrorState(error.message);
            if(btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    }

    function updateDashboard(report) {
        hidePlaceholder();
        updateKPIs(report.kpis);
        renderTrendChart(report.trendAnalysis);
        renderSentimentDonut(report.sentimentAnalysis);
        updateTopIssues(report.topIssues);
        updateInsights(report.insights);
        updateTimestamp(report.generatedAt);
    }
    
    function updateTimestamp(isoDate) {
        const dateElem = document.querySelector('.topbar-date');
        if (dateElem && isoDate) {
            const date = new Date(isoDate);
            dateElem.textContent = `Report generated: ${date.toLocaleString()}`;
        }
    }

    function showGenerateReportUI(sourceId = null) {
        const placeholder = document.getElementById('dashboard-placeholder');
        if (!placeholder) return;
        placeholder.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <div class="card-icon card-icon-orange">
                        <span>✦</span>
                    </div>
                    <div>
                        <div class="card-title">AI Report</div>
                        <div class="card-desc">Generate insights from your data</div>
                    </div>
                </div>
                <div class="card-body">
                    <div class="placeholder-content">
                        <div class="placeholder-icon">📄</div>
                        <h3>AI Report Not Found</h3>
                        <p>No AI report has been generated yet. Generate an AI-powered report to populate this dashboard with insights from your data.</p>
                        <button id="generate-report-btn" class="btn btn-primary">
                            <span>✦</span> Generate AI Report
                        </button>
                    </div>
                </div>
            </div>
        `;
        placeholder.classList.add('show');
        const generateBtn = document.getElementById('generate-report-btn');
        if (sourceId) {
            generateBtn.onclick = () => generateAIReport(sourceId);
        } else {
            generateBtn.onclick = () => generateAIReport();
        }
    }

    function showErrorState(message) {
        const placeholder = document.getElementById('dashboard-placeholder');
        if (!placeholder) return;
        placeholder.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <div class="card-icon card-icon-red">
                        <span>⚠️</span>
                    </div>
                    <div>
                        <div class="card-title">Error</div>
                        <div class="card-desc">Unable to load dashboard</div>
                    </div>
                </div>
                <div class="card-body">
                    <div class="placeholder-content">
                        <p>${message}</p>
                        <button id="retry-btn" class="btn btn-ghost">
                            <span>↻</span> Retry
                        </button>
                    </div>
                </div>
            </div>
        `;
        placeholder.classList.add('show');
        document.getElementById('retry-btn').addEventListener('click', () => location.reload());
    }

    function hidePlaceholder() {
        const placeholder = document.getElementById('dashboard-placeholder');
        if (placeholder) {
            placeholder.classList.remove('show');
        }
        const content = document.getElementById('dashboard-content');
        if(content) {
            content.style.visibility = 'visible';
            content.style.opacity = 1;
        }
    }

    function updateKPIs(kpis = []) {
        const kpiContainer = document.querySelector('.kpi-row');
        if (!kpiContainer) return;

        kpiContainer.innerHTML = kpis.map(kpi => {
            const deltaClass = kpi.delta.type === 'up' ? 'delta-up' : (kpi.delta.type === 'down' ? 'delta-down' : 'delta-warn');
            const deltaIcon = kpi.delta.type === 'up' ? '▲' : (kpi.delta.type === 'down' ? '▼' : '●');
            const colorClass = {
                'Total Feedback': 'kpi-blue',
                'Positive Sentiment': 'kpi-green',
                'Negative Issues': 'kpi-red',
                'New Sources': 'kpi-amber'
            }[kpi.label] || 'kpi-blue';

            return `
                <div class="kpi-card ${colorClass}">
                    <div class="kpi-label">${kpi.label}</div>
                    <div class="kpi-val">${kpi.value}</div>
                    <div class="kpi-meta">
                        ${kpi.delta.value ? `<div class="kpi-delta ${deltaClass}">${deltaIcon} ${kpi.delta.value}</div>` : ''}
                        <div class="kpi-meta-text">vs last week</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderTrendChart(trendData) {
        const ctx = document.getElementById('feedbackTrendChart')?.getContext('2d');
        if (!ctx || !trendData) return;

        if (trendChartInstance) {
            trendChartInstance.destroy();
        }

        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: trendData.labels,
                datasets: [
                    {
                        label: 'Positive',
                        data: trendData.datasets.find(d => d.label === 'Positive').data,
                        borderColor: CHART_COLORS.green,
                        backgroundColor: 'rgba(13, 122, 78, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                    },
                    {
                        label: 'Negative',
                        data: trendData.datasets.find(d => d.label === 'Negative').data,
                        borderColor: CHART_COLORS.red,
                        backgroundColor: 'rgba(192, 57, 43, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { drawBorder: false } },
                    x: { grid: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: '#0D1520',
                        titleFont: { weight: '600' },
                        bodyFont: { weight: '400' },
                        padding: 10,
                        cornerRadius: 8,
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                }
            }
        });
    }

    function renderSentimentDonut(sentimentData) {
        const ctx = document.getElementById('sentimentDonutChart')?.getContext('2d');
        if (!ctx || !sentimentData) return;

        const { positive, negative, neutral } = sentimentData;
        const total = positive + negative + neutral;

        if (sentimentDonutInstance) {
            sentimentDonutInstance.destroy();
        }

        sentimentDonutInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Positive', 'Negative', 'Neutral'],
                datasets: [{
                    data: [positive, negative, neutral],
                    backgroundColor: [CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.amber],
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });

        // Update legend
        document.getElementById('donut-positive-pct').textContent = `${Math.round((positive / total) * 100)}%`;
        document.getElementById('donut-positive-bar').style.width = `${(positive / total) * 100}%`;
        document.getElementById('donut-negative-pct').textContent = `${Math.round((negative / total) * 100)}%`;
        document.getElementById('donut-negative-bar').style.width = `${(negative / total) * 100}%`;
        document.getElementById('donut-neutral-pct').textContent = `${Math.round((neutral / total) * 100)}%`;
        document.getElementById('donut-neutral-bar').style.width = `${(neutral / total) * 100}%`;
    }

    function updateTopIssues(issues = []) {
        const container = document.getElementById('top-issues-list');
        if (!container) return;
        container.innerHTML = issues.map(issue => `
            <div class="issue-row">
                <div class="issue-rank">${issue.rank}</div>
                <div class="issue-swatch" style="background-color: ${issue.rank <= 2 ? CHART_COLORS.red : CHART_COLORS.amber};"></div>
                <div class="issue-info">
                    <div class="issue-title">${issue.title}</div>
                    <div class="issue-meta">${issue.category} · ${issue.mentions} mentions</div>
                </div>
                <i class="ph-arrow-right issue-arrow"></i>
            </div>
        `).join('');
    }

    function updateInsights(insights = []) {
        const container = document.getElementById('ai-insights-list');
        if (!container) return;
        container.innerHTML = insights.map(insight => `
            <div class="insight-item">
                <div class="insight-icon"><i class="ph-lightbulb"></i></div>
                <p class="insight-text">${insight}</p>
            </div>
        `).join('');
    }

    fetchAIReport();
});
