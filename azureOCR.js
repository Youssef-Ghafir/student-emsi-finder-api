const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
require("dotenv").config();

const client = new DocumentAnalysisClient(
  process.env.AZURE_DI_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_DI_KEY)
);

async function extractTableData(fileBuffer) {
  try {
    console.log("🔵 Sending PDF to Azure AI...");
    
    // "prebuilt-layout" is the model that detects Tables/Rows/Columns
    const poller = await client.beginAnalyzeDocument("prebuilt-layout", fileBuffer);
    const result = await poller.pollUntilDone();

    if (!result.tables || result.tables.length === 0) {
      console.log("❌ Azure found no tables.");
      return [];
    }

    console.log(`✅ Azure found ${result.tables.length} tables.`);
    const allStudents = [];

    for (const [index, table] of result.tables.entries()) {
        const rows = {};
        for (const cell of table.cells) {
            if (!rows[cell.rowIndex]) rows[cell.rowIndex] = {};
            rows[cell.rowIndex][cell.columnIndex] = cell.content;
        }
        Object.values(rows).forEach((row) => {
            // Simple validation to skip header rows
            // Checks if Name column exists, is long enough, and isn't the header "Nom"
            if (row[1] && row[1].length > 2 && !row[1].toLowerCase().includes("nom")) {
                allStudents.push({
                    numero: row[0],   // Assuming Column 0 is ID
                    name: row[1],     // Assuming Column 1 is Name
                    class: row[2] || "Unknown" // Assuming Column 2 is Room
                });
            }
        });
    }

    console.log(`✨ Total students extracted: ${allStudents.length}`);
    return allStudents;

  } catch (err) {
    console.error("Azure Error:", err.message);
  }
}

module.exports = { extractTableData };