const fs = require('fs');
const json = require('C:/Users/Cahyo/OneDrive/Documents/_Sabana/gen-lang-client-0336730579-813efa2a9ec1.json');

const envContent = `
GOOGLE_CLIENT_EMAIL="${json.client_email}"
GOOGLE_PRIVATE_KEY="${json.private_key.replace(/\n/g, '\\n')}"
GOOGLE_DRIVE_FOLDER_ID="1jyUcPhO6xxabLzFuLQ7BBv8oYVwh_Wz1"
`.trim();

fs.writeFileSync('.env', envContent);
console.log('.env created successfully');
