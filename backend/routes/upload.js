const express = require("express");
const router = express.Router();
const multer = require("multer");
const Papa = require("papaparse");
const XLSX = require("xlsx");
const { saveData } = require("../utils/storage");

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const isAllowedExtension = /\.(csv|xls|xlsx)$/i.test(file.originalname);
    if (isAllowedExtension) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV and Excel files are allowed.'), false);
    }
  }
});

/**
 * Parse CSV file using PapaParse
 * @param {Buffer} buffer - File buffer
 * @returns {Array} Array of parsed data objects
 */
function parseCSV(buffer) {
  const csvText = buffer.toString('utf-8');
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV parsing error: ${result.errors[0].message}`);
  }

  return result.data;
}

/**
 * Parse Excel file using xlsx
 * @param {Buffer} buffer - File buffer
 * @returns {Array} Array of parsed data objects
 */
function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0]; // Use first sheet
  const worksheet = workbook.Sheets[sheetName];

  // Convert to JSON with header row
  const jsonData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: ""
  });

  if (jsonData.length < 2) {
    throw new Error('Excel file must contain at least a header row and one data row');
  }

  // Convert to object format
  const headers = jsonData[0];
  const dataRows = jsonData.slice(1);

  return dataRows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] || "";
    });
    return obj;
  });
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pickFeedbackLikeText(row) {
  if (!row || typeof row !== 'object') return '';

  const entries = Object.entries(row).filter(([key]) => {
    const k = String(key || '').toLowerCase().trim();
    return !['sourceid', 'sourcetype', 'sourcename', 'createdat', 'id', '_id'].includes(k);
  });

  const preferred = entries.find(([key, value]) => {
    const k = String(key || '').toLowerCase();
    return /(feedback|comment|remarks?|review|text|message|description|issues? faced|experience|problem|complaint)/i.test(k)
      && normalizeText(value).length > 0;
  });

  if (preferred) return normalizeText(preferred[1]);

  const fallback = entries
    .map(([, value]) => normalizeText(value))
    .find((v) => v.length >= 2);

  return fallback || '';
}

function buildFallbackRowText(row) {
  if (!row || typeof row !== 'object') return '';

  const parts = Object.entries(row)
    .filter(([key]) => !['sourceId', 'sourceType', 'sourceName', 'createdAt', '_id', 'id', 'feedback'].includes(String(key)))
    .map(([, value]) => normalizeText(value))
    .filter((value) => value.length > 0);

  return normalizeText(parts.join(' | '));
}

// UPLOAD CSV/EXCEL FILE
router.post("/upload", upload.single('file'), async (req, res) => {
  console.log('Received file upload request');
  try {
    if (!req.file) {
      console.log('Upload error: No file was included in the request.');
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { originalname, mimetype, buffer } = req.file;
    console.log(`Processing file: ${originalname}, MIME type: ${mimetype}`);
    let parsedData = [];

    // Parse based on file extension (preferred) and fallback on mimetype
    const ext = (originalname.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || mimetype === 'text/csv' || mimetype === 'application/csv') {
      console.log('Parsing as CSV...');
      parsedData = parseCSV(buffer);
    } else if (ext === 'xls' || ext === 'xlsx' || mimetype.includes('excel') || mimetype.includes('spreadsheetml')) {
      console.log('Parsing as Excel...');
      parsedData = parseExcel(buffer);
    } else {
      console.log(`Upload error: Unsupported file type for ${originalname}`);
      return res.status(400).json({ error: "Unsupported file type" });
    }

    console.log(`Parsed ${parsedData.length} rows from file.`);

    if (parsedData.length === 0) {
      return res.status(400).json({ error: "No data found in file" });
    }

    // Add source metadata to each row
    const sourceId = `file_${originalname.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    const sourceType = 'file';
    const sourceName = originalname;

    const enrichedData = parsedData.map(row => ({
      ...row,
      sourceId,
      sourceType,
      sourceName,
      createdAt: new Date().toISOString()
    }));

    // Clean data and extract a feedback-like text from common or custom columns.
    // If no obvious feedback column exists, keep the row using a fallback text synthesis.
    const cleanedData = enrichedData
      .map(item => {
        const text = pickFeedbackLikeText(item) || buildFallbackRowText(item);
        return { ...item, feedback: text.toLowerCase() };
      })
      .filter(item => item.feedback && item.feedback.length > 0);

    console.log(`✓ Data cleaned successfully: ${cleanedData.length} records`);

    if (cleanedData.length === 0) {
      return res.status(400).json({ error: 'No usable rows found in file after cleaning' });
    }

    // Save to unified storage
    const success = saveData(cleanedData);

    if (!success) {
      return res.status(500).json({ error: 'Failed to save data' });
    }

    console.log(`✅ File uploaded successfully: ${originalname} (${cleanedData.length} records)`);
    res.json({
      message: 'File uploaded and data saved successfully',
      sourceId,
      sourceType,
      sourceName,
      recordsAdded: cleanedData.length,
      fileType: mimetype === 'text/csv' ? 'CSV' : 'Excel'
    });

  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({
      error: "Failed to process file",
      details: err.stack // Send stack for more details in dev
    });
  }
});

module.exports = router;