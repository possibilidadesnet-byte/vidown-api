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

// Health check
app.get('/', async (req, res) => {
  const exists = fs.existsSync(YTDLP_PATH);
  let version = null;
  if (exists) {
    try {
      version = await new Promise((resolve, reject) => {
        const child = spawn(YTDLP_PATH, ['--version'], { timeout: 10000 });
        let out = '';
        child.stdout.on('data', d => out += d);
        child.on('close', () => resolve(out.trim()));
        child.on('error', reject);
      });
    } catch (e) { version = 'error'; }
  }
  res.json({ status: 'ok', ytdlp_exists: exists, ytdlp_version: version });
});

// Endpoint de download → stream do arquivo
app.post('/download', async (req, res) => {
  const { url, isAudioOnly, quality } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'URL is required' });

  try {
    // Define formato
    let format = 'best';
    if (isAudioOnly) {
      format = 'bestaudio[ext=m4a]/bestaudio/best';
    } else if (quality && quality !== 'max') {
      format = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
    }

    // Obtém título para o nome do arquivo
    let title = 'video';
    try {
      title = await new Promise((resolve, reject) => {
        const child = spawn(YTDLP_PATH, [
          '--print', 'title',
          '--no-playlist',
          '--no-check-certificates',
          url
        ], { timeout: 30000 });
        let out = '';
        child.stdout.on('data', d => out += d);
        child.on('close', () => resolve(out.trim()));
        child.on('error', reject);
      });
      title = title || 'video';
      // Remove caracteres inválidos para nome de arquivo
      title = title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
    } catch (e) {
      console.warn('⚠️ Título não obtido, usando padrão');
    }

    const ext = isAudioOnly ? '.mp3' : '.mp4';
    const filename = encodeURIComponent(title + ext);

    // Define os argumentos do yt-dlp: download para stdout (-o -)
    const args = [
      '-f', format,
      '-o', '-',          // envia para stdout
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      url
    ];

    console.log('▶️ Baixando:', url, 'Formato:', format);

    // Spawn do processo
    const child = spawn(YTDLP_PATH, args, {
      timeout: 300000, // 5 minutos
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Configura cabeçalhos da resposta
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', isAudioOnly ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Pipe do stdout do yt-dlp para a resposta HTTP
    child.stdout.pipe(res);

    // Tratamento de erros
    child.stderr.on('data', (data) => {
      console.error('yt-dlp stderr:', data.toString());
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ yt-dlp finalizou com código', code);
        // Se ainda não enviou cabeçalhos, retorna erro
        if (!res.headersSent) {
          res.status(500).json({ status: 'error', text: 'Download failed' });
        }
      } else {
        console.log('✅ Download concluído');
      }
    });

    child.on('error', (err) => {
      console.error('❌ Erro ao spawn yt-dlp:', err);
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', text: 'Internal error' });
      }
    });

  } catch (error) {
    console.error('❌ Erro no endpoint /download:', error);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', text: 'Failed to process video.' });
    }
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
