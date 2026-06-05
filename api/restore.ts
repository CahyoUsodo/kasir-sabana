import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'stream';

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

    // Step 1: Get file metadata to determine the MIME type
    const fileMeta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType',
    });
    const mimeType = fileMeta.data.mimeType || '';
    console.log('Restore: file mimeType =', mimeType, ', name =', fileMeta.data.name);

    // Step 2: Download content based on MIME type
    let rawContent = '';

    const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
    const isGoogleSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
    const isGoogleWorkspace = mimeType.startsWith('application/vnd.google-apps.');

    if (isGoogleDoc || isGoogleSheet || isGoogleWorkspace) {
      // Google Workspace file — must use export
      // Try text/plain for Docs, text/csv for Sheets
      const exportMime = isGoogleSheet ? 'text/csv' : 'text/plain';
      console.log('Restore: exporting as', exportMime);
      const exportRes = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: 'text' }
      );
      rawContent = typeof exportRes.data === 'string' ? exportRes.data : String(exportRes.data);
    } else {
      // Regular file (application/json, application/octet-stream, etc.)
      // Download as stream and collect text
      const downloadRes = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      // Collect stream into string
      const chunks: Buffer[] = [];
      const stream = downloadRes.data as unknown as Readable;
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      rawContent = Buffer.concat(chunks).toString('utf-8');
    }

    // Step 3: Clean up and parse
    rawContent = rawContent.trim();
    // Remove BOM if present
    if (rawContent.charCodeAt(0) === 0xFEFF) {
      rawContent = rawContent.slice(1);
    }

    console.log('Restore: rawContent length =', rawContent.length, ', first 200 chars =', rawContent.substring(0, 200));

    if (!rawContent) {
      return res.status(400).json({ error: 'File kosong. Pastikan file sudah pernah di-backup sebelumnya.' });
    }

    let backupData;
    try {
      backupData = JSON.parse(rawContent);
    } catch (parseError: any) {
      return res.status(400).json({
        error: 'Isi file bukan format JSON yang valid. Kemungkinan file ini adalah Google Docs yang belum pernah di-backup. Lakukan Backup terlebih dahulu, lalu coba Restore lagi.',
        detail: rawContent.substring(0, 300),
      });
    }

    if (!backupData || !backupData.version) {
      return res.status(400).json({
        error: 'File bukan backup yang valid (tidak ada field "version"). Pastikan file ini sudah pernah di-backup dari aplikasi Kasir Sabana.',
        keys: backupData ? Object.keys(backupData).slice(0, 10) : [],
      });
    }

    return res.status(200).json({ success: true, backupData });

  } catch (error: any) {
    console.error('Restore Error:', error);
    const message = error.message || 'Internal Server Error';
    if (message.includes('File not found') || message.includes('not found')) {
      return res.status(404).json({ error: 'File tidak ditemukan. Pastikan File ID benar dan file sudah di-share ke Service Account email.' });
    }
    if (message.includes('The user does not have sufficient permissions')) {
      return res.status(403).json({ error: 'Service Account tidak punya akses ke file ini. Pastikan file sudah di-share ke email Service Account.' });
    }
    return res.status(500).json({ error: message });
  }
}
