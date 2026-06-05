import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId' });
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

    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Server missing Google Drive credentials' });
    }

    // Initialize Auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Download file content
    let response;
    try {
      response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
      );
    } catch (getFileError: any) {
      if (getFileError.message && getFileError.message.includes('Use Export with Docs Editors files')) {
        response = await drive.files.export(
          { fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
      } else {
        throw getFileError;
      }
    }

    let backupData;
    if (typeof response.data === 'string') {
      let rawString = response.data.trim();
      // Remove BOM if present
      if (rawString.charCodeAt(0) === 0xFEFF) {
        rawString = rawString.slice(1);
      }
      try {
        backupData = JSON.parse(rawString);
      } catch (parseError: any) {
        return res.status(400).json({ error: 'File berhasil diunduh, tetapi isinya BUKAN format teks JSON backup yang valid. Pastikan Anda menyalin isi JSON dengan benar ke dalam Google Docs.' });
      }
    } else {
      backupData = response.data;
    }

    if (!backupData || !backupData.version) {
      return res.status(400).json({ error: 'File bukan backup yang valid (tidak ada field version)' });
    }

    return res.status(200).json({ success: true, backupData });

  } catch (error: any) {
    console.error('Restore Error:', error);
    const message = error.message || 'Internal Server Error';
    if (message.includes('File not found')) {
      return res.status(404).json({ error: 'File tidak ditemukan. Pastikan File ID benar dan sudah di-share ke Service Account.' });
    }
    return res.status(500).json({ error: message });
  }
}
