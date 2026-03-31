const express = require('express');
const router = express.Router();
const axios = require('axios');

const { fetchSheetData } = require('../services/sheetsService');
const { saveData, getData, clearDataBySource, clearAllData } = require('../utils/storage');

// DATA ENDPOINT
router.get('/data', (req, res) => {
  try {
    const data = getData();
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('/api/data error:', err.message);
    res.status(500).json([]);
  }
});

// TEST ROUTE
router.get('/test', (req, res) => {
  res.json({ message: 'API working!' });
});

function extractSheetName(url) {
  if (!url) return 'Google Sheet';

  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return `Sheet (${match[1].slice(0, 8)})`;
  return 'Google Sheet';
}

function extractWebsiteName(input) {
  const value = String(input || '').trim();
  if (!value) return '';

  try {
    const asUrl = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(asUrl);
    return parsed.hostname.replace(/^www\./i, '').trim();
  } catch (_err) {
    return value.replace(/^www\./i, '').trim();
  }
}

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

function isMetaLikeKey(key) {
  const k = String(key || '').toLowerCase().trim();
  return /(timestamp|time stamp|email|e-mail|mail id|name|first name|last name|phone|mobile|contact|age|gender|city|location|address|id|token|otp)/i.test(k);
}

function pickFeedbackLikeText(row) {
  if (!row || typeof row !== 'object') return '';

  const entries = Object.entries(row)
    .filter(([key]) => !['sourceId', 'sourceType', 'sourceName', 'createdAt', '_id', 'id'].includes(String(key)))
    .map(([key, value]) => [String(key), normalizeText(value)]);

  const preferred = entries.find(([key, value]) =>
    !isMetaLikeKey(key) &&
    /(feedback|comment|review|remarks?|suggestion|improve|issue|problem|complaint|experience|opinion|reason|why)/i.test(key) &&
    value.length >= 3
  );

  const richCandidate = entries.find(([key, value]) =>
    !isMetaLikeKey(key) &&
    /(issues? faced|issue|problem|complaint|experience|review|remarks?|feedback|comment|description|suggestion|improve)/i.test(key) &&
    value.length >= 8
  );

  if (richCandidate) return richCandidate[1];
  if (preferred && !isLowSignalText(preferred[1])) return preferred[1];

  const longestMeaningful = entries
    .filter(([key, value]) => !isMetaLikeKey(key) && /[a-zA-Z]/.test(value) && value.length >= 8)
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (longestMeaningful) return longestMeaningful[1];

  return '';
}

// FETCH GOOGLE SHEET
router.post('/fetch-sheet', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const rawData = await fetchSheetData(url);
    if (!Array.isArray(rawData) || rawData.length < 2) {
      return res.status(400).json({ error: 'No rows found in sheet' });
    }

    const headers = rawData[0];
    const sourceId = `google_sheets_${Date.now()}`;
    const sourceType = 'google_sheets';
    const sourceName = extractSheetName(url);

    const jsonData = rawData.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });

      const feedbackText = pickFeedbackLikeText(obj);

      obj.sourceId = sourceId;
      obj.sourceType = sourceType;
      obj.sourceName = sourceName;
      obj.createdAt = new Date().toISOString();
      obj.feedback = feedbackText.toLowerCase();
      return obj;
    }).filter((item) => item.feedback && item.feedback.length > 0);

    if (!jsonData.length) {
      return res.status(400).json({ error: 'No usable feedback text found in the Google Sheet rows' });
    }

    const success = saveData(jsonData);
    if (!success) {
      return res.status(500).json({ error: 'Failed to save data' });
    }

    res.json({
      message: 'Sheet data fetched and saved successfully',
      sourceId,
      sourceType,
      sourceName,
      recordsAdded: jsonData.length,
    });
  } catch (err) {
    console.error('/fetch-sheet error:', err);
    res.status(500).json({ error: 'Failed to fetch sheet data', details: err.message });
  }
});

// FETCH GOOGLE FORUMS RESULTS VIA SERPAPI (Google Discussions tab)
router.post('/fetch-forums', async (req, res) => {
  try {
    const { website } = req.body;
    const websiteName = extractWebsiteName(website);
    if (!websiteName) return res.status(400).json({ error: 'Website name is required' });

    const apiKey = process.env.SERP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'SERP_API_KEY is missing. Add it to backend/.env before using forums fetch.'
      });
    }

    const forumFocusedQuery = `${websiteName} forum discussions community reviews`;

    const { data } = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: forumFocusedQuery,
        num: 20,
        hl: 'en',
        gl: 'in',
        api_key: apiKey
      },
      timeout: 20000
    });

    const organicResults = Array.isArray(data?.organic_results) ? data.organic_results : [];
    const forumHostRegex = /(reddit\.com|quora\.com|stackoverflow\.com|stackexchange\.com|forum|community|discuss|thread)/i;
    const forumResults = organicResults.filter((item) => {
      const link = String(item?.link || item?.url || '');
      const title = String(item?.title || '');
      const snippet = String(item?.snippet || item?.description || '');
      return forumHostRegex.test(link) || forumHostRegex.test(title) || forumHostRegex.test(snippet);
    });

    const pickedResults = forumResults.length ? forumResults : organicResults;

    if (!pickedResults.length) {
      return res.status(404).json({ error: `No forum results found for "${websiteName}"` });
    }

    const sourceId = `google_forums_${Date.now()}`;
    const sourceType = 'google_forums';
    const sourceName = `Google Forums: ${websiteName}`;

    const records = pickedResults
      .slice(0, 20)
      .map((result, index) => {
        const snippet = String(result.snippet || result.snippets || result.description || '').trim();
        return {
          title: String(result.title || `Forum result ${index + 1}`).trim(),
          link: String(result.link || result.url || ''),
          snippet,
          feedback: snippet.toLowerCase(),
          forumName: String(result.source || result.displayed_link || 'forum'),
          position: Number(result.position || index + 1),
          sourceId,
          sourceType,
          sourceName,
          createdAt: new Date().toISOString()
        };
      })
      .filter((item) => item.link || item.snippet || item.title);

    if (!records.length) {
      return res.status(404).json({ error: `No usable forum entries found for "${websiteName}"` });
    }

    const success = saveData(records);
    if (!success) {
      return res.status(500).json({ error: 'Failed to save forum results' });
    }

    res.json({
      message: 'Google forums data fetched and saved successfully',
      sourceId,
      sourceType,
      sourceName,
      recordsAdded: records.length,
      query: websiteName
    });
  } catch (err) {
    console.error('/fetch-forums error:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to fetch forum data from Google',
      details: err?.response?.data?.error || err.message
    });
  }
});

// Clear source records
router.delete('/data/:sourceId', (req, res) => {
  try {
    const { sourceId } = req.params;
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

    const success = clearDataBySource(sourceId);
    if (!success) {
      return res.status(500).json({ error: 'Failed to clear source data' });
    }

    res.json({ message: 'Source data cleared successfully' });
  } catch (err) {
    console.error('/data/:sourceId delete error:', err);
    res.status(500).json({ error: 'Failed to clear source data', details: err.message });
  }
});

// Clear all records
router.delete('/data', (req, res) => {
  try {
    const success = clearAllData();
    if (!success) {
      return res.status(500).json({ error: 'Failed to clear all data' });
    }
    res.json({ message: 'All data cleared successfully' });
  } catch (err) {
    console.error('/data delete error:', err);
    res.status(500).json({ error: 'Failed to clear all data', details: err.message });
  }
});

// GET all sources
router.get('/sources', (req, res) => {
  try {
    const allData = getData();
    const sourcesMap = {};

    allData.forEach((item) => {
      if (!item.sourceId) return;
      if (!sourcesMap[item.sourceId]) {
        sourcesMap[item.sourceId] = {
          sourceId: item.sourceId,
          sourceType: item.sourceType || 'unknown',
          sourceName: item.sourceName || item.sourceId,
          rows: 0,
          firstRow: item,
        };
      }
      sourcesMap[item.sourceId].rows += 1;
    });

    const sources = Object.values(sourcesMap);
    res.json({ count: sources.length, sources });
  } catch (err) {
    console.error('Error fetching sources:', err);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

// GET single source metadata
router.get('/source/:id', (req, res) => {
  try {
    const sourceId = req.params.id;
    const all = getData();
    const records = all.filter((r) => r.sourceId === sourceId);
    if (records.length === 0) return res.status(404).json({ error: 'Source not found' });
    const { sourceType, sourceName } = records[0];
    res.json({ sourceId, sourceType, sourceName, rows: records.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch source' });
  }
});

module.exports = router;
