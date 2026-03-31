const fs = require('fs');
const path = require('path');

// File paths for persistent storage
const DATA_FILE = path.join(__dirname, 'data.json');
const SOURCES_FILE = path.join(__dirname, 'sources.json');

let dataset = [];
let sources = [];
let sourceIdCounter = 1;

// ── FILE I/O HELPERS ──
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataset, null, 2));
  } catch (err) {
    console.error('Error saving data.json:', err.message);
  }
}

function saveSources() {
  try {
    fs.writeFileSync(SOURCES_FILE, JSON.stringify({ sources, sourceIdCounter }, null, 2));
  } catch (err) {
    console.error('Error saving sources.json:', err.message);
  }
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
      dataset = JSON.parse(fileContent);
      console.log(`✓ Loaded ${dataset.length} records from data.json`);
    }
  } catch (err) {
    console.error('Error loading data.json:', err.message);
    dataset = [];
  }
}

function loadSources() {
  try {
    if (fs.existsSync(SOURCES_FILE)) {
      const fileContent = fs.readFileSync(SOURCES_FILE, 'utf-8');
      const data = JSON.parse(fileContent);
      sources = data.sources || [];
      sourceIdCounter = data.sourceIdCounter || 1;
      console.log(`✓ Loaded ${sources.length} sources from sources.json`);
    }
  } catch (err) {
    console.error('Error loading sources.json:', err.message);
    sources = [];
    sourceIdCounter = 1;
  }
}

// ── INITIALIZATION ──
function initDataStore() {
  loadData();
  loadSources();
}

/** Add data to dataset and return source index */
function addData(newData) {
  const dataIndexStart = dataset.length;
  dataset = [...dataset, ...newData];
  saveData(); // Persist to file
  return { start: dataIndexStart, end: dataset.length - 1 };
}

function getData() {
  return dataset;
}

/** Create a new source and track it */
function createSource(sourceData) {
  const source = {
    id: sourceIdCounter++,
    name: sourceData.name || `Sheet ${sourceIdCounter}`,
    url: sourceData.url,
    type: "Google Sheet",
    rows: sourceData.rows,
    status: "Connected",
    preview: sourceData.preview,
    dataIndexStart: sourceData.dataIndexStart,
    dataIndexEnd: sourceData.dataIndexEnd,
    createdAt: new Date().toISOString()
  };
  
  sources.push(source);
  saveSources(); // Persist to file
  return source;
}

function getSources() {
  return sources;
}

function getSourceById(id) {
  return sources.find(s => s.id === parseInt(id));
}

function deleteSource(id) {
  const sourceIndex = sources.findIndex(s => s.id === parseInt(id));
  if (sourceIndex > -1) {
    const source = sources[sourceIndex];
    sources.splice(sourceIndex, 1);
    
    // Remove associated data from dataset
    if (source.dataIndexStart !== undefined && source.dataIndexEnd !== undefined) {
      dataset.splice(source.dataIndexStart, source.dataIndexEnd - source.dataIndexStart + 1);
      
      // Update remaining sources' indices
      sources = sources.map(s => {
        if (s.dataIndexStart > source.dataIndexEnd) {
          const diff = source.dataIndexEnd - source.dataIndexStart + 1;
          return {
            ...s,
            dataIndexStart: s.dataIndexStart - diff,
            dataIndexEnd: s.dataIndexEnd - diff
          };
        }
        return s;
      });
    }
    
    // Persist changes to files
    saveData();
    saveSources();
    return true;
  }
  return false;
}

function getSourcePreview(id) {
  const source = getSourceById(id);
  if (!source) return null;
  return source.preview;
}

function getSourceData(id) {
  const source = getSourceById(id);
  if (!source) return null;
  return dataset.slice(source.dataIndexStart, source.dataIndexEnd + 1);
}

module.exports = {
  initDataStore,
  addData,
  getData,
  createSource,
  getSources,
  getSourceById,
  deleteSource,
  getSourcePreview,
  getSourceData
};