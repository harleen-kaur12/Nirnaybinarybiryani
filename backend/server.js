const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require('path');
const axios = require('axios');
require('dotenv').config();
const { getData } = require('./utils/storage');

const app = express();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_API_KEY = GROQ_API_KEY || OPENAI_API_KEY;
const AI_PROVIDER = GROQ_API_KEY ? 'groq' : 'openai';
const AI_MODEL = process.env.AI_MODEL || process.env.GROQ_MODEL || process.env.OPENAI_MODEL || (GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
const ALLOWED_GROQ_URLS = [
  'https://api.groq.com/v1',
  'https://api.groq.com/openai/v1'
];
const defaultGroqUrl = process.env.AI_BASE_URL || 'https://api.groq.com/v1';
const useGroqUrl = ALLOWED_GROQ_URLS.includes(defaultGroqUrl) ? defaultGroqUrl : 'https://api.groq.com/v1';
const AI_BASE_URL = process.env.AI_BASE_URL || (GROQ_API_KEY ? useGroqUrl : 'https://api.openai.com/v1');

if (!AI_API_KEY) {
  console.error("❌ No AI API Key found. Check .env file");
}

console.log("GROQ KEY:", process.env.GROQ_API_KEY);
console.log("AI PROVIDER:", AI_PROVIDER);
console.log("BASE URL:", AI_BASE_URL);


process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
  // keep process alive after reporting
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  // do not exit to keep server alive
});

app.use(cors());
app.use(express.json());

const sheetsRoutes = require('./routes/sheets');
const uploadRoutes = require('./routes/upload');
const aiRoutes = require('./routes/ai');

app.use('/api', sheetsRoutes);
app.use('/api', uploadRoutes);
app.use('/api/ai', aiRoutes);


const META_KEYS = new Set([
  'sourceid',
  'sourcetype',
  'sourcename',
  'createdat',
  '_id',
  'id'
]);

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have', 'has', 'had',
  'was', 'were', 'are', 'is', 'will', 'would', 'should', 'could', 'into', 'about',
  'than', 'then', 'them', 'they', 'their', 'there', 'here', 'very', 'just', 'more',
  'most', 'some', 'such', 'only', 'also', 'over', 'under', 'after', 'before', 'been',
  'being', 'because', 'while', 'when', 'what', 'where', 'which', 'who', 'whom',
  'why', 'how', 'too', 'not', 'our', 'out', 'all', 'any', 'each', 'few', 'other',
  'same', 'own', 'can', 'did', 'does', 'doing', 'done', 'a', 'an', 'in', 'on', 'to',
  'of', 'it', 'as', 'or', 'if', 'at', 'by', 'be', 'we', 'you', 'i'
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickRecordText(record) {
  if (!record || typeof record !== 'object') return '';

  const entries = Object.entries(record).filter(([key]) => !META_KEYS.has(String(key).toLowerCase()));
  if (!entries.length) return '';

  const preferred = entries.find(([key, value]) =>
    /(feedback|comment|remark|issue|problem|complaint|review|text|message|description)/i.test(key) &&
    value !== null &&
    value !== undefined &&
    normalizeText(value) !== ''
  );

  if (preferred) return normalizeText(preferred[1]);

  const fallback = entries.find(([, value]) => value !== null && value !== undefined && normalizeText(value) !== '');
  return fallback ? normalizeText(fallback[1]) : '';
}

function classifyCategory(text) {
  const t = text.toLowerCase();

  if (/(slow|delay|late|wait|queue|staff|service|support|response)/.test(t)) return 'Service Quality';
  if (/(price|pricing|cost|expensive|cheap|value|discount)/.test(t)) return 'Pricing & Value';
  if (/(quality|broken|defect|damage|durable|material|feature|bug)/.test(t)) return 'Product Quality';
  if (/(delivery|logistics|shipment|stock|inventory|availability)/.test(t)) return 'Operations & Delivery';
  if (/(great|excellent|good|love|amazing|satisfied|happy)/.test(t)) return 'Positive Experience';
  return 'General Feedback';
}

function sentimentScore(text) {
  const t = text.toLowerCase();
  const positive = /(great|excellent|good|love|amazing|satisfied|happy|fast|helpful|smooth)/.test(t);
  const negative = /(bad|poor|slow|delay|issue|problem|complaint|broken|expensive|confusing)/.test(t);

  if (positive && !negative) return 1;
  if (negative && !positive) return -1;
  return 0;
}

function topTerms(texts, limit = 3) {
  const counts = new Map();

  texts.forEach((text) => {
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
      .forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!sorted.length) return ['volume', 'pattern', 'trend'].slice(0, limit);

  return sorted.map(([word, count]) => `${word} (${count})`);
}

function buildDecisionTree(records) {
  const texts = records
    .map(pickRecordText)
    .map(normalizeText)
    .filter(Boolean);

  if (!texts.length) return { roots: [] };

  const grouped = new Map();
  texts.forEach((text) => {
    const category = classifyCategory(text);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(text);
  });

  const roots = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([category, categoryTexts]) => {
      const volume = categoryTexts.length;
      const pct = Math.round((volume / texts.length) * 100);
      const avgSentiment = categoryTexts.reduce((sum, t) => sum + sentimentScore(t), 0) / volume;
      const sentimentLabel = avgSentiment < 0 ? 'negative' : avgSentiment > 0 ? 'positive' : 'mixed';

      const subFactors = topTerms(categoryTexts, 3).map((term) => ({ text: term }));

      return {
        problem: `${category} (${volume} records)`,
        subFactors,
        branches: [
          {
            condition: `If recurrence remains high (${pct}% of feedback)`,
            actions: [
              {
                action: 'Prioritize immediate corrective workflow',
                finalActions: [
                  { text: 'Assign owner and SLA within 24h' },
                  { text: 'Track closure weekly' }
                ]
              },
              {
                action: 'Run short-cycle validation with affected users',
                finalActions: [
                  { text: 'Collect targeted follow-up feedback' },
                  { text: 'Update process baseline' }
                ]
              }
            ]
          },
          {
            condition: `If sentiment is ${sentimentLabel}`,
            actions: [
              {
                action: avgSentiment < 0 ? 'Escalate root-cause remediation plan' : 'Scale winning practices',
                finalActions: [
                  { text: avgSentiment < 0 ? 'Publish mitigation timeline' : 'Document repeatable playbook' },
                  { text: avgSentiment < 0 ? 'Monitor risk indicators' : 'Reinforce quality checks' }
                ]
              }
            ]
          }
        ]
      };
    });

  return { roots };
}

function cleanJsonText(text) {
  if (!text) return '';
  const trimmed = String(text).trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

function normalizeAiTreeShape(tree) {
  if (!tree || !Array.isArray(tree.roots)) return { roots: [] };

  const roots = tree.roots
    .slice(0, 6)
    .map((root) => {
      const problem = normalizeText(root && root.problem ? root.problem : 'General Feedback');
      const subFactorsRaw = Array.isArray(root && root.subFactors) ? root.subFactors : [];
      const branchesRaw = Array.isArray(root && root.branches) ? root.branches : [];

      const subFactors = subFactorsRaw
        .slice(0, 5)
        .map((item) => ({ text: normalizeText(item && item.text ? item.text : item) }))
        .filter((item) => item.text);

      const branches = branchesRaw
        .slice(0, 4)
        .map((branch) => {
          const condition = normalizeText(branch && branch.condition ? branch.condition : 'Condition');
          const actionsRaw = Array.isArray(branch && branch.actions) ? branch.actions : [];

          const actions = actionsRaw
            .slice(0, 4)
            .map((actionNode) => {
              const action = normalizeText(actionNode && actionNode.action ? actionNode.action : 'Recommended action');
              const finalRaw = Array.isArray(actionNode && actionNode.finalActions) ? actionNode.finalActions : [];
              const finalActions = finalRaw
                .slice(0, 3)
                .map((item) => ({ text: normalizeText(item && item.text ? item.text : item) }))
                .filter((item) => item.text);

              return {
                action,
                finalActions: finalActions.length ? finalActions : [{ text: 'Track impact and iterate' }]
              };
            })
            .filter((item) => item.action);

          return {
            condition,
            actions: actions.length ? actions : [{ action: 'Investigate root cause', finalActions: [{ text: 'Implement corrective action' }] }]
          };
        })
        .filter((item) => item.condition);

      return {
        problem,
        subFactors: subFactors.length ? subFactors : [{ text: 'feedback pattern' }],
        branches: branches.length
          ? branches
          : [{ condition: 'If issue persists', actions: [{ action: 'Escalate response plan', finalActions: [{ text: 'Review outcomes weekly' }] }] }]
      };
    })
    .filter((root) => root.problem);

  return { roots };
}

function buildDataProfile(records) {
  const normalizedRecords = Array.isArray(records) ? records : [];
  const texts = normalizedRecords.map(pickRecordText).map(normalizeText).filter(Boolean);

  const sourceCounts = new Map();
  normalizedRecords.forEach((record) => {
    const sourceName = normalizeText(record && (record.sourceName || record.sourceId || 'Unknown source')) || 'Unknown source';
    sourceCounts.set(sourceName, (sourceCounts.get(sourceName) || 0) + 1);
  });

  const categoryCounts = new Map();
  texts.forEach((text) => {
    const category = classifyCategory(text);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });

  const sentiment = { positive: 0, negative: 0, neutral: 0 };
  texts.forEach((text) => {
    const score = sentimentScore(text);
    if (score > 0) sentiment.positive += 1;
    else if (score < 0) sentiment.negative += 1;
    else sentiment.neutral += 1;
  });

  const totalTexts = texts.length || 1;
  const topThemes = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => ({
      theme,
      count,
      share: Math.round((count / totalTexts) * 100)
    }));

  const sourceBreakdown = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([source, count]) => ({ source, count }));

  const sentimentLabel = sentiment.negative > sentiment.positive
    ? 'negative-leaning'
    : sentiment.positive > sentiment.negative
      ? 'positive-leaning'
      : 'mixed';

  return {
    totalRecords: normalizedRecords.length,
    totalTexts: texts.length,
    totalSources: sourceCounts.size,
    topThemes,
    sourceBreakdown,
    topKeywords: topTerms(texts, 10),
    sentiment: {
      ...sentiment,
      label: sentimentLabel
    }
  };
}

function buildRulesReportFromProfile(profile) {
  const leadTheme = profile.topThemes[0];
  const secondTheme = profile.topThemes[1];
  const leadSource = profile.sourceBreakdown[0];
  const keywordLine = profile.topKeywords.slice(0, 4).join(', ');

  const overview = profile.totalRecords === 0
    ? 'No uploaded records are available yet. Upload data to generate AI-driven reporting.'
    : `Analyzed ${profile.totalRecords} uploaded records across ${profile.totalSources} sources. Overall sentiment is ${profile.sentiment.label}.`;

  const insights = [];
  if (leadTheme) insights.push(`${leadTheme.theme} is the dominant theme (${leadTheme.count} records, ${leadTheme.share}%).`);
  if (secondTheme) insights.push(`${secondTheme.theme} is the secondary theme (${secondTheme.count} records, ${secondTheme.share}%).`);
  if (leadSource) insights.push(`Highest volume source: ${leadSource.source} (${leadSource.count} records).`);
  if (keywordLine) insights.push(`Most frequent signal terms: ${keywordLine}.`);

  const recommendations = [];
  if (leadTheme) recommendations.push(`Create a focused action sprint for ${leadTheme.theme.toLowerCase()} and track closure rate weekly.`);
  if (profile.sentiment.negative > profile.sentiment.positive) recommendations.push('Run a rapid root-cause review on high-friction records and assign owners with SLAs.');
  if (profile.sentiment.positive >= profile.sentiment.negative) recommendations.push('Convert positive patterns into playbooks and replicate across teams/sources.');
  recommendations.push('Refresh this report after each upload to monitor trend shifts in near real-time.');

  const risks = [];
  if (leadTheme && leadTheme.share >= 45) risks.push(`Concentration risk: ${leadTheme.theme} accounts for nearly half of all feedback.`);
  if (profile.sentiment.negative >= Math.max(8, profile.totalTexts * 0.35)) risks.push('Sustained negative sentiment can impact retention if unresolved items remain open.');
  if (!profile.totalRecords) risks.push('No data risk: reports and decision guidance are unavailable until records are uploaded.');

  const nextActions = [
    {
      action: leadTheme ? `Launch mitigation plan for ${leadTheme.theme.toLowerCase()}.` : 'Upload records and generate baseline report.',
      ownerHint: 'Operations lead',
      priority: 'high'
    },
    {
      action: 'Review source-level variance and rebalance quality checks.',
      ownerHint: 'Data owner',
      priority: 'medium'
    },
    {
      action: 'Publish weekly status update with trend deltas.',
      ownerHint: 'Program manager',
      priority: 'medium'
    }
  ];

  return {
    overview,
    insights: insights.length ? insights : ['Upload data to generate insights.'],
    recommendations: recommendations.length ? recommendations : ['Upload data to generate recommendations.'],
    risks: risks.length ? risks : ['No major risks detected from current uploaded records.'],
    nextActions
  };
}

function normalizeAiReportShape(report) {
  const safeList = (items, fallback) => {
    if (!Array.isArray(items)) return fallback;
    const cleaned = items.map((v) => normalizeText(v)).filter(Boolean).slice(0, 8);
    return cleaned.length ? cleaned : fallback;
  };

  const rawNext = Array.isArray(report && report.nextActions) ? report.nextActions : [];
  const nextActions = rawNext
    .slice(0, 6)
    .map((item) => ({
      action: normalizeText(item && item.action),
      ownerHint: normalizeText(item && item.ownerHint),
      priority: normalizeText(item && item.priority).toLowerCase() || 'medium'
    }))
    .filter((item) => item.action)
    .map((item) => ({
      action: item.action,
      ownerHint: item.ownerHint || 'Team owner',
      priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium'
    }));

  return {
    overview: normalizeText(report && report.overview) || 'AI report generated.',

    insights: safeList(
      report && report.insights,
      [
        'Customer feedback shows recurring operational inefficiencies',
        'Service-related issues are impacting overall satisfaction',
        'Patterns in feedback suggest gaps in delivery or communication'
      ]
    ),

    recommendations: safeList(
      report && report.recommendations,
      [
        'Improve service response time and customer handling process',
        'Optimize pricing strategy to better match perceived value',
        'Enhance product/service quality using continuous feedback loops'
      ]
    ),

    risks: safeList(
      report && report.risks,
      [
        'Unresolved issues may reduce customer retention over time',
        'Negative sentiment trends can impact brand perception',
        'Operational inefficiencies may scale with increased demand'
      ]
    ),

    improvements: safeList(
      report && report.improvements,
      [
        'Improve data analysis depth for better insights',
        'Enhance feedback categorization and tagging system',
        'Optimize operational workflows to reduce inefficiencies'
      ]
    ),

    nextActions: nextActions.length
      ? nextActions
      : [
        {
          action: 'Review uploaded data and identify key problem areas',
          ownerHint: 'Team owner',
          priority: 'medium'
        }
      ]
  };
}

async function buildAiReportFromRecords(records, profile) {
  if (!AI_API_KEY) {
    throw new Error('No AI API key configured (set GROQ_API_KEY or OPENAI_API_KEY)');
  }

  const sample = (Array.isArray(records) ? records : [])
    .map((record) => ({
      text: pickRecordText(record),
      source: normalizeText(record && (record.sourceName || record.sourceId || 'unknown')) || 'unknown'
    }))
    .filter((item) => item.text)
    .slice(0, 200);

  const prompt = {
    task: "Analyze customer feedback deeply and generate actionable business insights.",
    rules: [
      "Return STRICT JSON only. No markdown.",
      "You MUST fill ALL sections: overview, insights, recommendations, risks, improvements, nextActions.",
      "DO NOT leave any section empty.",
      "Each of insights, recommendations, risks, improvements must have at least 3 bullet points.",
      "Do NOT write 'No insights generated' or similar.",
      "Be specific and data-driven.",
      "Think like a senior business consultant.",
      "Output schema: {overview, insights, recommendations, risks, improvements, nextActions}"
    ],
    instructions: [
      "Look for repeated complaints or patterns.",
      "Even if feedback is neutral, suggest improvements.",
      "Never say 'no improvement identified'.",
      "Focus on operations, UX, pricing, delivery."
    ],
    dataProfile: profile,
    recordSample: sample
  };

  const response = await axios.post(
    `${AI_BASE_URL}/chat/completions`,
    {
      model: AI_MODEL,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: 'You are a senior business analyst. Use only provided uploaded-data context and return strict JSON.'
        },
        {
          role: 'user',
          content: JSON.stringify(prompt)
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  const content = response?.data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(cleanJsonText(content));
  return normalizeAiReportShape(parsed);
}

async function buildDecisionTreeWithAI(records) {
  if (!AI_API_KEY) {
    throw new Error('No AI API key configured (set GROQ_API_KEY or OPENAI_API_KEY)');
  }

  const sample = records
    .map((record) => ({
      text: pickRecordText(record),
      sourceName: record && record.sourceName ? String(record.sourceName) : 'unknown'
    }))
    .filter((item) => item.text)
    .slice(0, 400);

  if (!sample.length) return { roots: [] };

  const profile = buildDataProfile(records);
  const prompt = {
    task: 'Generate a highly insightful business decision tree from customer feedback data.',

    dataSummary: profile,   // ✅ THIS IS WHAT YOU WERE ASKING

    feedbackSample: sample,

    rules: [
      'Return JSON only. No markdown.',
      'Use real patterns, not generic statements.',
      'Each root must represent a major business problem derived from feedback.',
      'SubFactors must be specific causes (not generic words like "issue" or "problem").',
      'Conditions must be measurable or scenario-based (e.g., "If delay > 3 days").',
      'Actions must be practical and implementable.',
      'Final actions must be clear execution steps.',
      'Avoid repetition across branches.',

      'Output must follow exactly: {"roots":[{"problem":"...","subFactors":[{"text":"..."}],"branches":[{"condition":"...","actions":[{"action":"...","finalActions":[{"text":"..."}]}]}]}]}',

      'Use 2-4 roots, each with 2-4 subFactors, 2-3 branches, 2-3 actions per branch.'
    ]
  };

  const response = await axios.post(
    `${AI_BASE_URL}/chat/completions`,
    {
      model: AI_MODEL,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: 'You are an expert operations strategist. You must output strict JSON only, valid and parseable.'
        },
        {
          role: 'user',
          content: JSON.stringify(prompt)
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  const content = response?.data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(cleanJsonText(content));
  return normalizeAiTreeShape(parsed);
}

// Explicit data endpoint for frontend checks
app.get('/api/data', (req, res) => {
  console.log('GET /api/data (server.js route)');
  try {
    const allData = getData();
    const result = Array.isArray(allData) ? allData : [];
    res.json(result);
  } catch (err) {
    console.error('API /api/data error:', err.message);
    res.json([]);
  }
});

app.get('/api/decision-tree', (req, res) => {
  console.log('GET /api/decision-tree (server.js route)');
  const mode = String(req.query.mode || 'auto').toLowerCase();

  try {
    const allData = getData();
    const result = Array.isArray(allData) ? allData : [];

    if (mode === 'rules') {
      const tree = buildDecisionTree(result);
      return res.json({ ...tree, meta: { generator: 'rules' } });
    }

    if (mode === 'ai' && !AI_API_KEY) {
      return res.status(503).json({
        roots: [],
        meta: {
          generator: 'none',
          error: 'Missing API key. Set GROQ_API_KEY or OPENAI_API_KEY to enable AI mode.'
        }
      });
    }

    if (AI_API_KEY) {
      buildDecisionTreeWithAI(result)
        .then((tree) => {
          res.json({ ...tree, meta: { generator: 'ai', provider: AI_PROVIDER, model: AI_MODEL } });
        })
        .catch((aiErr) => {
          console.error('AI decision-tree generation failed:', aiErr.message);
          console.error("❌ AI TREE ERROR FULL:", aiErr.response?.data || aiErr.message);
          const fallback = buildDecisionTree(result);
          res.json({
            ...fallback,
            meta: {
              generator: 'rules',
              fallbackReason: 'ai_failed'
            }
          });
        });
      return;
    }

    const tree = buildDecisionTree(result);
    res.json({ ...tree, meta: { generator: 'rules', fallbackReason: 'missing_ai_key' } });
  } catch (err) {
    console.error('API /api/decision-tree error:', err.message);
    res.status(500).json({ roots: [], meta: { generator: 'none', error: err.message } });
  }
});

app.get('/api/ai-reports', async (req, res) => {
  console.log('GET /api/ai-reports (server.js route)');
  const mode = String(req.query.mode || 'auto').toLowerCase();

  try {
    const allData = getData();
    const records = Array.isArray(allData) ? allData : [];
    const profile = buildDataProfile(records);

    if (mode === 'rules') {
      const report = buildRulesReportFromProfile(profile);
      return res.json({ summary: profile, report, meta: { generator: 'rules' } });
    }

    if (mode === 'ai' && !AI_API_KEY) {
      return res.status(503).json({
        summary: profile,
        report: buildRulesReportFromProfile(profile),
        meta: {
          generator: 'rules',
          fallbackReason: 'missing_ai_key'
        }
      });
    }

    if (AI_API_KEY) {
      try {
        const report = await buildAiReportFromRecords(records, profile);
        return res.json({
          summary: profile,
          report,
          meta: { generator: 'ai', provider: AI_PROVIDER, model: AI_MODEL }
        });
      } catch (aiErr) {
        console.error("🔥 FULL AI ERROR:");
        console.error(aiErr.response?.data || aiErr.message || aiErr);
      }
    }

    const fallbackReport = buildRulesReportFromProfile(profile);
    return res.json({
      summary: profile,
      report: fallbackReport,
      meta: { generator: 'rules', fallbackReason: AI_API_KEY ? 'ai_failed' : 'missing_ai_key' }
    });
  } catch (err) {
    console.error('API /api/ai-reports error:', err.message);
    res.status(500).json({
      summary: { totalRecords: 0, totalTexts: 0, totalSources: 0, topThemes: [], sourceBreakdown: [], topKeywords: [], sentiment: { positive: 0, negative: 0, neutral: 0, label: 'mixed' } },
      report: { overview: 'Failed to generate report.', insights: [], recommendations: [], risks: [], nextActions: [] },
      meta: { generator: 'none', error: err.message }
    });
  }
});

// Routes (existing feature routes)
const sheetsRoute = require('./routes/sheets');
const uploadRoute = require('./routes/upload');
app.use('/api', sheetsRoute);
app.use('/api', uploadRoute);

app.listen(5000, () => {
  console.log('Server started successfully');
  console.log('Server running on port 5000');
  console.log('Available endpoints:');
  console.log('  GET /api/data');
  console.log('  GET /api/decision-tree');
  console.log('  GET /api/ai-reports');
  console.log('  POST /api/upload');
  console.log('  GET /api/test');
});