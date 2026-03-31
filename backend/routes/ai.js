const express = require('express');
const router = express.Router();
const { getData } = require('../utils/storage');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_API_KEY = GROQ_API_KEY || OPENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || process.env.GROQ_MODEL || process.env.OPENAI_MODEL || (GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
const AI_BASE_URL = process.env.AI_BASE_URL || (GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');

const reportFilePath = path.join(__dirname, '..', 'data', 'ai-report.json');

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isLowSignalText(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return true;

    const words = normalized.split(/\s+/).filter(Boolean);
    const hasSignal = /(issue|problem|complaint|delay|slow|poor|bad|broken|excellent|great|good|happy|satisfied|service|support|response|quality|installation|maintenance|cost|price|communication|dissatisfied|improvement)/i.test(normalized);
    return words.length <= 3 && !hasSignal;
}

function pickRecordText(record) {
    if (!record || typeof record !== 'object') return '';

    const richFields = ['issues faced', 'issue', 'problem', 'complaint', 'experience', 'remarks', 'review', 'feedback', 'comment', 'description'];
    const preferredKeys = ['feedback', 'comment', 'review', 'message', 'description', 'remarks', 'issue', 'complaint'];

    for (const [key, value] of Object.entries(record)) {
        const k = String(key || '').toLowerCase().trim();
        const text = normalizeText(value);
        if (!text || isLowSignalText(text)) continue;
        if (richFields.some((field) => k.includes(field))) return text;
    }

    for (const key of preferredKeys) {
        const matchKey = Object.keys(record).find((k) => String(k).toLowerCase() === key);
        if (matchKey) {
            const text = normalizeText(record[matchKey]);
            if (text && !isLowSignalText(text)) return text;
        }
    }

    const fallback = Object.entries(record)
        .filter(([key]) => !['sourceid', 'sourcetype', 'sourcename', 'createdat', '_id', 'id'].includes(String(key).toLowerCase()))
        .map(([, value]) => normalizeText(value))
        .find((value) => value.length > 0);

    return fallback || '';
}

function classifySentiment(text) {
    const t = String(text || '').toLowerCase();
    const positive = /(great|excellent|good|happy|satisfied|love|amazing|smooth|fast|helpful|easy)/.test(t);
    const negative = /(bad|poor|slow|delay|issue|problem|complaint|bug|error|confusing|crash|difficult)/.test(t);

    if (positive && !negative) return 'Positive';
    if (negative && !positive) return 'Negative';
    return 'Neutral';
}

function classifyIssueCategory(text) {
    const t = String(text || '').toLowerCase();
    if (/(price|cost|expensive|cheap|discount)/.test(t)) return 'Pricing';
    if (/(service|support|staff|response)/.test(t)) return 'Service';
    if (/(delivery|shipment|stock|availability|logistics)/.test(t)) return 'Operations';
    if (/(app|ui|ux|login|dashboard|feature|bug|error|crash)/.test(t)) return 'Product';
    return 'General';
}

function buildLast7DaysTrend(recordsWithSentiment) {
    const dates = [];
    const dateMap = new Map();

    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dates.push(key);
        dateMap.set(key, { Positive: 0, Negative: 0 });
    }

    recordsWithSentiment.forEach((item) => {
        const date = new Date(item.createdAt || Date.now());
        const key = Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
        if (!key || !dateMap.has(key)) return;
        if (item.sentiment === 'Positive') dateMap.get(key).Positive += 1;
        if (item.sentiment === 'Negative') dateMap.get(key).Negative += 1;
    });

    return {
        labels: dates.map((d) => {
            const dt = new Date(d);
            return dt.toLocaleDateString('en-US', { weekday: 'short' });
        }),
        datasets: [
            { label: 'Positive', data: dates.map((d) => dateMap.get(d).Positive) },
            { label: 'Negative', data: dates.map((d) => dateMap.get(d).Negative) }
        ]
    };
}

// Data-driven report generator based on uploaded/forum records
async function generateAIReport(data) {
    console.log('Generating AI report from uploaded data...');

    const totalRecords = data.length;
    const sources = [...new Set(data.map(item => item.sourceName || item.sourceId || 'Unknown source'))];

    const enriched = data.map((item) => {
        const text = pickRecordText(item);
        const sentiment = classifySentiment(text);
        const category = classifyIssueCategory(text);
        return { ...item, __text: text, __sentiment: sentiment, __category: category };
    });

    const positiveCount = enriched.filter((r) => r.__sentiment === 'Positive').length;
    const negativeCount = enriched.filter((r) => r.__sentiment === 'Negative').length;
    const neutralCount = enriched.filter((r) => r.__sentiment === 'Neutral').length;

    const categoryCounts = {};
    enriched.forEach((r) => {
        categoryCounts[r.__category] = (categoryCounts[r.__category] || 0) + 1;
    });

    const topIssues = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, mentions], index) => ({
            rank: index + 1,
            title: `${category} related feedback requires attention`,
            category,
            mentions
        }));

    const positivePercent = totalRecords > 0 ? Math.round((positiveCount / totalRecords) * 100) : 0;
    const trendAnalysis = buildLast7DaysTrend(
        enriched.map((r) => ({ createdAt: r.createdAt, sentiment: r.__sentiment }))
    );

    const dominantCategory = topIssues[0]?.category || 'General';

    const report = {
        generatedAt: new Date().toISOString(),
        kpis: [
            { id: 'total-feedback', label: 'Total Feedback', value: totalRecords, delta: { type: 'up', value: '' }, sparkline: [] },
            { id: 'positive-sentiment', label: 'Positive Sentiment', value: `${positivePercent}%`, delta: { type: positivePercent >= 50 ? 'up' : 'down', value: '' }, sparkline: [] },
            { id: 'negative-issues', label: 'Negative Issues', value: negativeCount, delta: { type: negativeCount > 0 ? 'warn' : 'up', value: '' }, sparkline: [] },
            { id: 'new-sources', label: 'New Sources', value: sources.length, delta: { type: 'stale', value: '' }, sparkline: [] },
        ],
        sentimentAnalysis: {
            positive: positiveCount,
            negative: negativeCount,
            neutral: neutralCount,
        },
        trendAnalysis,
        topIssues,
        insights: [
            `Report generated from ${totalRecords} uploaded/forum records across ${sources.length} source(s).`,
            `Dominant issue area: ${dominantCategory}.`,
            `Sentiment split: ${positiveCount} positive, ${negativeCount} negative, ${neutralCount} neutral.`
        ]
    };

    if (AI_API_KEY) {
        try {
            const sampleTexts = enriched.map(r => r.__text).filter(Boolean).slice(0, 40);
            const prompt = `You are an expert data analyst. Based on this customer feedback data summary: Total Records: ${totalRecords}, Dominant Category: ${dominantCategory}, Positive: ${positiveCount}, Negative: ${negativeCount}. Sample feedback texts: ${JSON.stringify(sampleTexts)}. Provide 3 short, highly actionable business insights in a strict JSON array of strings format. Return ONLY the JSON array. Example: ["Insight 1", "Insight 2", "Insight 3"]`;

            const aiResponse = await axios.post(`${AI_BASE_URL}/chat/completions`, {
                model: AI_MODEL,
                temperature: 0.2,
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { Authorization: `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
                timeout: 30000
            });
            let content = aiResponse.data.choices[0].message.content.trim();
            if (content.startsWith('\`\`\`')) {
                content = content.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '').trim();
            }
            report.insights = JSON.parse(content);
        } catch (e) {
            console.error('AI Insight generation failed:', e.message);
        }
    }

    console.log('AI report generated from current dataset.');
    return report;
}

router.post('/generate-report', async (req, res) => {
    try {
        const { sourceId } = req.body; // Allow filtering by sourceId
        const allData = getData();

        if (!allData || allData.length === 0) {
            return res.status(400).json({ error: 'No data available to generate a report.' });
        }

        // Filter data by sourceId if provided, otherwise use all data
        const dataToProcess = sourceId 
            ? allData.filter(item => item.sourceId === sourceId) 
            : allData;

        if (dataToProcess.length === 0) {
            const errorMessage = sourceId
                ? `No data found for sourceId: ${sourceId}`
                                : 'No data available to generate a report.';
            return res.status(400).json({ error: errorMessage });
        }

        const report = await generateAIReport(dataToProcess);
        await fs.writeFile(reportFilePath, JSON.stringify(report, null, 2));

        res.status(201).json({ message: 'AI report generated and saved successfully.', report });
    } catch (error) {
        console.error('Error generating AI report:', error);
        res.status(500).json({ error: 'Failed to generate AI report.', details: error.message });
    }
});

router.get('/report', async (req, res) => {
    try {
        const reportData = await fs.readFile(reportFilePath, 'utf8');
        res.json(JSON.parse(reportData));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'AI report not found. Please generate one first.' });
        }
        console.error('Error fetching AI report:', error);
        res.status(500).json({ error: 'Failed to fetch AI report.' });
    }
});

module.exports = router;
