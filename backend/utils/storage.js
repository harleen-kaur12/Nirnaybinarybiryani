const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

/**
 * Save new data to the unified data.json file
 * @param {Array} newData - Array of data objects to append
 */
function saveData(newData) {
  try {
    // Read existing data
    let existingData = [];
    if (fs.existsSync(DATA_FILE)) {
      const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
      existingData = JSON.parse(fileContent);
    }

    // Append new data
    const updatedData = [...existingData, ...newData];

    // Write back to file
    fs.writeFileSync(DATA_FILE, JSON.stringify(updatedData, null, 2));

    console.log(`✓ Saved ${newData.length} records to data.json (total: ${updatedData.length})`);
    return true;
  } catch (err) {
    console.error('Error saving data:', err.message);
    return false;
  }
}

/**
 * Get all data from the unified data.json file
 * @returns {Array} Array of all stored data objects
 */
function getData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(fileContent);
      console.log(`✓ Loaded ${data.length} records from data.json`);
      return data;
    }
    return [];
  } catch (err) {
    console.error('Error reading data:', err.message);
    return [];
  }
}

function clearDataBySource(sourceId) {
  try {
    const existing = getData();
    const filtered = existing.filter(record => record.sourceId !== sourceId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(filtered, null, 2));
    console.log(`✓ Cleared data for source ${sourceId}. Records removed: ${existing.length - filtered.length}`);
    return true;
  } catch (err) {
    console.error('Error clearing source data:', err.message);
    return false;
  }
}

function clearAllData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
    console.log('✓ Cleared all records from data.json');
    return true;
  } catch (err) {
    console.error('Error clearing all data:', err.message);
    return false;
  }
}

module.exports = {
  saveData,
  getData,
  clearDataBySource,
  clearAllData
};