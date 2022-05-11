import cors from 'cors';
import express from 'express';
import fs from 'fs';
import scrapeGoogleImages, { Task } from './src/google-images-scraper';

interface APIResponse {
  status: 'success' | 'fail' | 'error';
  message?: string;
  data: object;
}

const app = express();
const port = process.env.PORT || 4000;
const tasks = new Map<string, Task>();
const outputFolderPath = `${__dirname}/output`;

// Delete all files in output folder
fs.rmSync(outputFolderPath, { recursive: true });
fs.mkdirSync(outputFolderPath);

// Express middleware
app.use(express.json());
app.use(express.urlencoded());
app.use(
  cors({
    origin: '*',
  })
);

app.get('/', (req, res) => {
  res.end('Sever is up & running...');
});

app.post('/scrape-google-images', async (req, res) => {
  const { search, numOfImages, ...searchOptions } = req.body;
  if (!search || !numOfImages) {
    return res.json({
      status: 'fail',
      message: 'search or numOfImages is not defined',
      data: {},
    } as APIResponse);
  }

  const onTaskCreate = (task: Task) => {
    const taskId = task.taskId;
    tasks.set(taskId, task);
    res.status(202);
    res.setHeader(
      'Location',
      `${req.protocol}://${req.hostname}/check-scraping-progress/${taskId}`
    );
    res.json({
      status: 'success',
      data: {
        ...task,
      },
    } as APIResponse);
    return task;
  };

  scrapeGoogleImages(search, numOfImages, onTaskCreate, searchOptions);
});

app.get('/check-scraping-progress/:taskId', async (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    return res.json({
      status: 'fail',
      message: 'Task does not exist, invalid taskId',
      data: {},
    } as APIResponse);
  }

  res.json({
    status: 'success',
    data: {
      ...task,
    },
  } as APIResponse);
});

app.get('/download-scraped-images/:taskId', (req, res) => {
  const zipPath = `${outputFolderPath}/${req.params.taskId}.zip`;
  if (!fs.existsSync(zipPath))
    return res.json({ status: 'fail', msg: 'File Does Not Exist', data: {} });
  else res.download(zipPath);
});

app.listen(port, () => {
  console.log('Server is up & running');
});
