const axios = require("axios");

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error("❌ Missing GOOGLE_API_KEY in .env");
}

function extractSheetId(url) {
  return url.split("/d/")[1].split("/")[0];
}

async function fetchSheetData(sheetUrl) {
  const sheetId = extractSheetId(sheetUrl);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Form Responses 1?key=${API_KEY}`;

  const response = await axios.get(url);

  return response.data.values;
}

module.exports = { fetchSheetData };