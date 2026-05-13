const express = require('express');
const cors = require('cors');
const YtDlpWrap = require('yt-dlp-wrap').default;
const app = express();

app.use(cors());
app.use(express.json());

// Instancia com o caminho padrão (yt-dlp será baixado automaticamente)
const ytDlpWrap = new YtDlpWrap();

// Rota de health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Vidown API (yt-dlp) is running' });
});

// Endpoint principal de download
app.post('/download', async (req, res) => {
  const { url, isAudioOnly, quality } = req.body;

  if (!url) {
    return res.status(400).json({ status: 'error', text: 'URL is required' });
  }

  try {
    // Busca informações do vídeo
    const info = await ytDlpWrap.getVideoInfo(url);
    const title = info.title || 'video';

    // Define o formato com base na qualidade e tipo
    let format;
    if (isAudioOnly) {
      format = 'bestaudio[ext=m4a]/bestaudio/best';
    } else {
      const height = quality || 1080;
      format = `bestvideo[height<=${height}]+bestaudio[height<=${height}]/best[height<=${height}]/best`;
    }

    // Obtém a URL do stream
    const streamUrl = await ytDlpWrap.execPromise([
      url,
      '-f', format,
      '-g', // retorna apenas a URL
      '--no-check-certificates'
    ]);

    res.json({
      status: 'stream',
      url: streamUrl.trim(),
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
