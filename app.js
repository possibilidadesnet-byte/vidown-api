const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

// Caminho onde o yt-dlp será armazenado
const YTDLP_PATH = path.join(__dirname, 'yt-dlp');

// Função para baixar o yt-dlp mais recente
function downloadYtDlp() {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(YTDLP_PATH);
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Segue o redirect
        https.get(response.headers.location, (redirectRes) => {
          redirectRes.pipe(file);
          file.on('finish', () => {
            file.close();
            fs.chmodSync(YTDLP_PATH, '755'); // Torna executável
            console.log('yt-dlp baixado com sucesso');
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.chmodSync(YTDLP_PATH, '755');
          console.log('yt-dlp baixado com sucesso');
          resolve();
        });
      }
    }).on('error', reject);
  });
}

// Função para executar o yt-dlp
function execYtDlp(args) {
  return new Promise((resolve, reject) => {
    const cmd = `${YTDLP_PATH} ${args.join(' ')}`;
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Rota de health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Vidown API (yt-dlp) is running',
    ytdlp_exists: fs.existsSync(YTDLP_PATH)
  });
});

// Endpoint de informações do vídeo
app.post('/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'URL is required' });

  try {
    const output = await execYtDlp(['--dump-json', '--no-playlist', url]);
    const info = JSON.parse(output);
    res.json({ status: 'ok', title: info.title, duration: info.duration });
  } catch (error) {
    res.status(500).json({ status: 'error', text: 'Failed to get video info' });
  }
});

// Endpoint principal de download
app.post('/download', async (req, res) => {
  const { url, isAudioOnly, quality } = req.body;

  if (!url) {
    return res.status(400).json({ status: 'error', text: 'URL is required' });
  }

  try {
    // Primeiro obtém informações do vídeo
    const infoOutput = await execYtDlp(['--dump-json', '--no-playlist', url]);
    const info = JSON.parse(infoOutput);
    const title = info.title || 'video';

    // Define o formato
    let formatArg;
    if (isAudioOnly) {
      formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
    } else {
      const height = quality || 1080;
      formatArg = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    }

    // Obtém a URL do stream (usando -g para retornar apenas URL)
    const streamUrl = await execYtDlp([
      '-f', formatArg,
      '-g',
      '--no-playlist',
      '--no-check-certificates',
      url
    ]);

    res.json({
      status: 'stream',
      url: streamUrl,
      title: title
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      status: 'error',
      text: 'Failed to process video. Please try again later.'
    });
  }
});

// Inicializa o servidor e baixa o yt-dlp
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
