import archiver from 'archiver';
import axios from 'axios';
import { randomUUID } from 'crypto';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { URL } from 'url';

const IMG_SELECTOR = '#islrg > div.islrc > div > a:nth-child(2)';

interface SearchFilter {
  color?:
    | 'gray'
    | 'trans'
    | 'specific,isc:red'
    | 'specific,isc:orange'
    | 'specific,isc:yellow'
    | 'specific,isc:green'
    | 'specific,isc:teal'
    | 'specific,isc:blue'
    | 'specific,isc:purple'
    | 'specific,isc:pink'
    | 'specific,isc:white'
    | 'specific,isc:gray'
    | 'specific,isc:black'
    | 'specific,isc:brown';
  size?: 'l' | 'm' | 'i';
  type?: 'clipart' | 'lineart' | 'animated';
  time?: 'd' | 'w' | 'm' | 'y';
  userRights?: 'cl' | 'ol';
}

export interface Task {
  taskId: string;
  msg: string;
  status: 'LOADING' | 'SUCCESS' | 'FAIL';
  progress: string;
}

export default async function scrapeGoogleImages(
  search: string,
  numOfImages: number,
  onTaskCreated: (task: Task) => Task,
  filter?: SearchFilter
): Promise<string[]> {
  // Create taskProgress object & pass it to onTaskCreated
  let task = onTaskCreated({
    taskId: randomUUID(),
    msg: 'Initializing...',
    status: 'LOADING',
    progress: '',
  });

  // Add search query & search filter to searchUrl
  const searchUrl = new URL('https://www.google.com/search?tbm=isch');
  searchUrl.searchParams.append('q', search);
  if (filter) _addSearchOptionsToSearchParams(filter, searchUrl);

  // Open browser & search for images
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = (await browser.pages()).pop()!;
  const response = await page
    .goto(searchUrl.toString(), {
      waitUntil: 'domcontentloaded',
    })
    .catch(() => {
      task.msg = 'Initialization Failed';
      task.status = 'FAIL';
      browser.close();
    });

  if (!response) return [];

  // If no images found, return an empty array
  let images = await page.$$(IMG_SELECTOR);
  if (images.length === 0) {
    task.msg = 'No Images Found';
    task.status = 'FAIL';
    return [];
  }

  task.msg = 'Loading Images...';
  task.progress = `${images.length} Images Found`;

  // Loop until #images loaded < #images to download
  // or until end of the page is reached
  while (images.length < numOfImages) {
    // Scroll & wait while content is loading or
    // don't wait if no more relevant results found
    await page.waitForFunction(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const msg = document.querySelector('#islmp .Bqq24e')!.textContent;
      const seeMoreAnyway = document.querySelector('#islmp > div > div > div > div.WYR1I > span');
      return seeMoreAnyway || msg !== 'Wait while more content is being loaded';
    });

    // Load more if more content can be loaded
    await page.$eval('#islmp input[type=button]', (el) => {
      if (el.parentElement!.style.display === '') (el as HTMLLIElement).click();
    });

    // Check if the end of the page is reached or no more relevant results found
    const endOfPageReached = await page.$eval('#islmp .Bqq24e', (el) => {
      window.scrollTo(0, document.body.scrollHeight);
      const seeMoreAnyway = document.querySelector('#islmp > div > div > div > div.WYR1I > span');
      const end = (el as HTMLElement).innerText === "Looks like you've reached the end";
      return seeMoreAnyway?.textContent === 'See more anyway' || end;
    });

    // Select all images & break the loop if end of the page is reached
    images = await page.$$(IMG_SELECTOR);
    task.progress = `${images.length} Images Found`;

    if (endOfPageReached) break;
  }

  // If #images found < #images to download, then #images to download = #images found
  numOfImages = images.length >= numOfImages ? numOfImages : images.length;

  const results = Array<string>();
  task.msg = 'Getting Image Links...';
  task.progress = `${results.length}/${numOfImages} Images Loaded`;

  // Loop through images ElementHandle & add image links to results array
  for (const image of images) {
    try {
      // Click & wait for href to load
      await image.click();
      await page.waitForFunction((el: HTMLLinkElement) => el.href !== '', {}, image);

      // Get href attribute from image
      const hrefAttribute = await image.getProperty('href');
      const href = await hrefAttribute.jsonValue();

      // Get image url form href attribute
      const url = new URL(href as string);
      const imgUrl = url.searchParams.get('imgurl');

      // Add image url to results array
      results.push(imgUrl as string);
      task.progress = `${results.length}/${numOfImages} Images Loaded`;
    } catch (e) {
      console.error(e);
      continue;
    }

    // Break the loop if result is done
    if (results.length >= numOfImages) break;
  }

  await browser.close();

  await _downloadAndCompressImages(results, task);

  task.status = 'SUCCESS';
  task.msg = 'Your Images Are Ready';
  return results;
}

async function _downloadAndCompressImages(images: string[], task: Task) {
  const pathToZip = `${__dirname}/../output/${task.taskId}.zip`;
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(fs.createWriteStream(pathToZip));

  let numOfImagesDownloaded = 0;
  task.msg = 'Downloading Images...';
  task.progress = `${++numOfImagesDownloaded}/${images.length} Images Downloaded`;

  const values = await Promise.allSettled(
    images.map((url) => {
      return axios.get(url, { responseType: 'arraybuffer' }).then((res) => {
        task.progress = `${++numOfImagesDownloaded}/${images.length} Images Downloaded`;
        return res;
      });
    })
  );

  values.forEach((value) => {
    if (value.status === 'fulfilled') {
      const fileExtension = value.value.headers['content-type'].split('/').pop();
      const fileName = `${randomUUID()}.${fileExtension}`;
      archive.append(value.value.data, { name: fileName });
    }
  });

  archive.finalize();

  // Delete zip after 30 minutes
  setTimeout(() => {
    if (fs.existsSync(pathToZip)) fs.rmSync(pathToZip);
  }, 30 * 60 * 1000);
}

function _addSearchOptionsToSearchParams(options: SearchFilter, searchUrl: URL) {
  let optionsParams = '';
  if (options.size) optionsParams += `isz:${options.size},`;
  if (options.color) optionsParams += `ic:${options.color},`;
  if (options.type) optionsParams += `itp:${options.type},`;
  if (options.time) optionsParams += `qdr:${options.time},`;
  if (options.userRights) optionsParams += `il:${options.userRights}`;
  searchUrl.searchParams.append('tbs', optionsParams);
}
