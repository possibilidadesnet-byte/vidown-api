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

// ------------------------------------------------------------
// BAIXAR O YT-DLP (caso não exista)
// ------------------------------------------------------------
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
            console.log('✅ yt-dlp baixado com sucesso');
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.chmodSync(YTDLP_PATH, '755');
          console.log('✅ yt-dlp baixado com sucesso');
          resolve();
        });
      }
    }).on('error', reject);
  });
}

// ------------------------------------------------------------
// EXECUTAR O YT-DLP (captura tudo)
// ------------------------------------------------------------
function execYtDlp(args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const cmd = `${YTDLP_PATH} ${args.join(' ')}`;
    console.log('▶️ Executando:', cmd);
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Erro exec:', error.message);
        console.error('stderr:', stderr);
        reject({ message: error.message, stderr: stderr || '', stdout: stdout || '' });
      } else {
        console.log('✅ stdout (primeiros 200 chars):', stdout.slice(0, 200));
        resolve(stdout.trim());
      }
    });
  });
}

// ------------------------------------------------------------
// ENDPOINT DE DEBUG – testa o yt-dlp com um vídeo real
// ------------------------------------------------------------
app.get('/debug', async (req, res) => {
  const testUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpBQ';
  try {
    const stdout = await execYtDlp([
      '--dump-json',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--simulate',
      '--print', 'title',
      testUrl
    ], 120000);
    res.json({ status: 'ok', title: stdout });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      stderr: err.stderr,
      stdout: err.stdout
    });
  }
});

// ------------------------------------------------------------
// ENDPOINT DE DOWNLOAD
// ------------------------------------------------------------
app.post('/download', async (req, res) => {
  const { url, isAudioOnly, quality } = req.body;

  if (!url) {
    return res.status(400).json({ status: 'error', text: 'URL is required' });
  }

  try {
    // 1. Obter info do vídeo
    const infoOutput = await execYtDlp([
      '--dump-json',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      url
    ]);
    const info = JSON.parse(infoOutput);
    const title = info.title || 'video';

    // 2. Definir formato
    let formatArg;
    if (isAudioOnly) {
      formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
    } else {
      const height = quality || 1080;
      formatArg = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    }

    // 3. Obter URL do stream (com fallback)
    let streamUrl;
    try {
      streamUrl = await execYtDlp([
        '-f', formatArg,
        '-g',
        '--no-playlist',
        '--no-check-certificates',
        '--geo-bypass',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        url
      ]);
    } catch (formatError) {
      console.warn('⚠️ Formato específico falhou, tentando best...');
      streamUrl = await execYtDlp([
        '-f', 'best',
        '-g',
        '--no-playlist',
        '--no-check-certificates',
        '--geo-bypass',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        url
      ]);
    }

    res.json({
      status: 'stream',
      url: streamUrl,
      title: title
    });

  } catch (error) {
    // Retorna o erro completo para diagnóstico
    console.error('❌ Download error:', error);
    res.status(500).json({
      status: 'error',
      text: 'Failed to process video.',
      detail: error.stderr || error.message,
      hint: 'If you see "HTTP Error 403" or "Sign in", the video might be restricted. Try another video.'
    });
  }
});

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------
app.get('/', async (req, res) => {
  const exists = fs.existsSync(YTDLP_PATH);
  let version = null;
  if (exists) {
    try {
      version = await execYtDlp(['--version'], 15000);
    } catch (e) {
      version = 'error: ' + e.message;
    }
  }
  res.json({
    status: 'ok',
    ytdlp_exists: exists,
    ytdlp_version: version,
    message: 'Vidown API (yt-dlp) is running'
  });
});

// ------------------------------------------------------------
// INICIALIZAÇÃO
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function start() {
  if (!fs.existsSync(YTDLP_PATH)) {
    console.log('⬇️ Baixando yt-dlp...');
    try {
      await downloadYtDlp();
    } catch (error) {
      console.error('Falha ao baixar yt-dlp:', error);
    }
  } else {
    console.log('✅ yt-dlp já existe');
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

start();
