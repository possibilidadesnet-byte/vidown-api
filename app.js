const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
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

// Executa comando yt-dlp
function execYtDlp(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const cmd = `${YTDLP_PATH} ${args.join(' ')}`;
    console.log('▶️', cmd);
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ stderr:', stderr);
        reject(new Error(stderr || error.message));
      } else {
        console.log('✅ stdout (primeiros 150 chars):', stdout.slice(0, 150));
        resolve(stdout.trim());
      }
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
      '--geo-bypass',
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
      // Tenta altura específica, com fallback automático para best
      format = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
    }

    // Obtém título
    let title = 'video';
    try {
      const infoOutput = await execYtDlp([
        '--print', 'title',
        '--no-playlist',
        '--no-check-certificates',
        url
      ]);
      title = infoOutput || title;
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
