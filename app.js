const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

const YTDLP_PATH = path.join(__dirname, 'yt-dlp');

// Baixa o yt-dlp se necessário
function downloadYtDlp() {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(YTDLP_PATH);
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (redirectRes) => {
          redirectRes.pipe(file);
          file.on('finish', () => {
            file.close();
            fs.chmodSync(YTDLP_PATH, '755');
            console.log('✅ yt-dlp baixado');
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.chmodSync(YTDLP_PATH, '755');
          console.log('✅ yt-dlp baixado');
          resolve();
        });
      }
    }).on('error', reject);
  });
}

// Executa yt-dlp com spawn (SEM shell)
function execYtDlp(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    console.log('▶️', YTDLP_PATH, args.join(' '));
    const child = spawn(YTDLP_PATH, args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ exit code', code);
        console.error('stderr:', stderr);
        reject(new Error(stderr || `Process exited with code ${code}`));
      } else {
        console.log('✅ stdout (primeiros 150 chars):', stdout.slice(0, 150));
        resolve(stdout.trim());
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Health check
app.get('/', async (req, res) => {
  const exists = fs.existsSync(YTDLP_PATH);
  let version = null;
  if (exists) {
    try { version = await execYtDlp(['--version'], 10000); } catch (e) { version = 'error'; }
  }
  res.json({ status: 'ok', ytdlp_exists: exists, ytdlp_version: version });
});

// Debug: testa extração de título
app.get('/debug', async (req, res) => {
  try {
    const stdout = await execYtDlp([
      '--print', 'title',
      '--no-playlist',
      '--no-check-certificates',
      'https://www.youtube.com/watch?v=aqz-KE-bpBQ'
    ]);
    res.json({ status: 'ok', title: stdout });
  } catch (e) {
    res.status(500).json({ status: 'error', detail: e.message });
  }
});

// Endpoint de download
app.post('/download', async (req, res) => {
  const { url, isAudioOnly, quality } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'URL is required' });

  try {
    // Define formato – prioriza o 'best' que é universal e estável
    let format = 'best';
    if (isAudioOnly) {
      format = 'bestaudio[ext=m4a]/bestaudio/best';
    } else if (quality && quality !== 'max') {
      format = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
    }

    // Obtém título
    let title = 'video';
    try {
      const titleOutput = await execYtDlp([
        '--print', 'title',
        '--no-playlist',
        '--no-check-certificates',
        url
      ]);
      title = titleOutput || title;
    } catch (infoErr) {
      console.warn('⚠️ Não foi possível obter título:', infoErr.message);
    }

    // Obtém URL do stream (apenas a URL com -g)
    const streamUrl = await execYtDlp([
      '-f', format,
      '-g',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      url
    ]);

    // Verificação extra: se a URL retornada parece ser uma página HTML, rejeita
    if (streamUrl.includes('youtube.com') || streamUrl.includes('.html') || streamUrl.includes('accounts.google.com')) {
      throw new Error('URL retornada não é um stream de mídia: ' + streamUrl.slice(0, 200));
    }

    res.json({ status: 'stream', url: streamUrl, title: title });

  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({
      status: 'error',
      text: 'Failed to process video.',
      detail: error.message.slice(0, 500)
    });
  }
});

const PORT = process.env.PORT || 3000;
async function start() {
  if (!fs.existsSync(YTDLP_PATH)) {
    console.log('⬇️ Baixando yt-dlp...');
    try { await downloadYtDlp(); } catch (e) { console.error('Falha:', e); }
  }
  app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
}
start();
