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

// Baixa o yt-dlp
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
            console.log('yt-dlp baixado');
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.chmodSync(YTDLP_PATH, '755');
          console.log('yt-dlp baixado');
          resolve();
        });
      }
    }).on('error', reject);
  });
}

// Executa yt-dlp com timeout e captura de erros
function execYtDlp(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const cmd = `${YTDLP_PATH} ${args.join(' ')}`;
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error) {
        // Rejeita com detalhes do stderr
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Rota de health check
app.get('/', async (req, res) => {
  const exists = fs.existsSync(YTDLP_PATH);
  let version = null;
  if (exists) {
    try {
      version = await execYtDlp(['--version'], 10000);
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

// Endpoint de teste rápido
app.get('/test', async (req, res) => {
  try {
    const output = await execYtDlp(['--version'], 10000);
    res.json({ status: 'ok', version: output });
  } catch (e) {
    res.status(500).json({ status: 'error', text: e.message });
  }
});

// Endpoint de download
app.post('/download', async (req, res) => {
  const { url, isAudioOnly, quality } = req.body;

  if (!url) {
    return res.status(400).json({ status: 'error', text: 'URL is required' });
  }

  try {
    // Primeiro tenta obter informações (já valida se o vídeo existe)
    const infoOutput = await execYtDlp([
      '--dump-json',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      url
    ]);
    const info = JSON.parse(infoOutput);
    const title = info.title || 'video';

    // Define o formato com fallback
    let formatArg;
    if (isAudioOnly) {
      formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
    } else {
      const height = quality || 1080;
      // Tenta o formato específico, depois o best geral
      formatArg = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    }

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
      // Se falhar com o formato específico, tenta com best
      console.warn('Formato específico falhou, tentando best...');
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
    console.error('Erro completo:', error);
    res.status(500).json({
      status: 'error',
      text: 'Failed to process video. ' + error.message.slice(0, 300)
    });
  }
});

// Inicialização
const PORT = process.env.PORT || 3000;

async function start() {
  if (!fs.existsSync(YTDLP_PATH)) {
    console.log('Baixando yt-dlp...');
    try {
      await downloadYtDlp();
    } catch (error) {
      console.error('Falha ao baixar yt-dlp:', error);
    }
  } else {
    console.log('yt-dlp já existe');
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();
