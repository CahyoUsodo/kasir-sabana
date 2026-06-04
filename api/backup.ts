import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { storeName, backupData } = req.body;

    if (!storeName || !backupData) {
      return res.status(400).json({ error: 'Missing storeName or backupData' });
    }

    let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

    if (process.env.GOOGLE_DRIVE_CREDENTIALS) {
      try {
        const creds = JSON.parse(process.env.GOOGLE_DRIVE_CREDENTIALS);
        if (creds.client_email) clientEmail = creds.client_email;
        if (creds.private_key) privateKey = creds.private_key;
      } catch (e) {
        console.error('Failed to parse GOOGLE_DRIVE_CREDENTIALS', e);
      }
    }

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!clientEmail || !privateKey || !folderId) {
      return res.status(500).json({ error: 'Server missing Google Drive credentials' });
    }

    // Initialize Auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // File name
    // Replace invalid characters from storeName to make it a safe filename
    const safeStoreName = storeName.replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/\s+/g, '_');
    const fileName = `Backup_Kasir_${safeStoreName}.json`;

    // 1. Check if file already exists in the folder
    const query = `'${folderId}' in parents and name = '${fileName}' and trashed = false`;
    const searchRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    const existingFile = searchRes.data.files && searchRes.data.files.length > 0 
                         ? searchRes.data.files[0] 
                         : null;

    const fileMetadata = {
      name: fileName,
      ...(existingFile ? {} : { parents: [folderId] }) // Only set parents for new files
    };

    const media = {
      mimeType: 'application/json',
      body: JSON.stringify(backupData, null, 2),
    };

    let result;
    if (existingFile && existingFile.id) {
      // Overwrite existing file
      result = await drive.files.update({
        fileId: existingFile.id,
        media: media,
      });
    } else {
      // Create new file
      result = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
      });
    }

    return res.status(200).json({ success: true, fileId: result.data.id });

  } catch (error: any) {
    console.error('Backup Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
