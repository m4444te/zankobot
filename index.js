require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Configuration from environment variables
const config = {
  instanceUrl: process.env.FEDIVERSE_INSTANCE_URL,
  accessToken: process.env.FEDIVERSE_ACCESS_TOKEN,
  imageFolder: process.env.IMAGE_FOLDER || './images',
  postedFolder: process.env.POSTED_FOLDER || './posted',
  statusText: process.env.STATUS_TEXT || '#ZoltanAsanski #Photography #Art',
  postInterval: 15 * 60 * 1000 // 15 minutes in milliseconds
};

let imageFiles = [];
let currentIndex = 0;

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

async function ensureDirectoryExists(directory) {
  try {
    await fs.access(directory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      log(`Creating directory: ${directory}`);
      await fs.mkdir(directory, { recursive: true });
    } else {
      throw error;
    }
  }
}

async function loadImageFiles() {
  try {
    log('Starting to load image files...');
    await ensureDirectoryExists(config.imageFolder);
    await ensureDirectoryExists(config.postedFolder);
    const files = await fs.readdir(config.imageFolder);
    imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
    log(`Loaded ${imageFiles.length} images from ${config.imageFolder}`);
    log(`Image files: ${imageFiles.join(', ')}`);
  } catch (error) {
    log(`Error reading image folder: ${error.message}`, 'error');
  }
}

async function movePostedImage(imagePath) {
  const fileName = path.basename(imagePath);
  const destinationPath = path.join(config.postedFolder, fileName);
  try {
    await fs.rename(imagePath, destinationPath);
    log(`Moved ${fileName} to ${config.postedFolder}`);
  } catch (error) {
    log(`Error moving file ${fileName}: ${error.message}`, 'error');
  }
}

async function postImageToFediverse(imagePath) {
  log(`Attempting to post image: ${imagePath}`);
  const formData = new FormData();
  try {
    const fileContent = await fs.readFile(imagePath);
    formData.append('file', fileContent, path.basename(imagePath));
    log('File read successfully and added to form data');
  } catch (error) {
    log(`Error reading file ${imagePath}: ${error.message}`, 'error');
    return;
  }

  try {
    log('Uploading media to Fediverse instance...');
    const mediaResponse = await axios.post(`${config.instanceUrl}/api/v1/media`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${config.accessToken}`
      }
    });

    const mediaId = mediaResponse.data.id;
    log(`Media uploaded successfully. Media ID: ${mediaId}`);

    log('Posting status with media...');
    await axios.post(`${config.instanceUrl}/api/v1/statuses`, {
      status: config.statusText,
      media_ids: [mediaId]
    }, {
      headers: {
        'Authorization': `Bearer ${config.accessToken}`
      }
    });

    log(`Successfully posted ${path.basename(imagePath)}`);
    await movePostedImage(imagePath);
  } catch (error) {
    log(`Error posting ${path.basename(imagePath)}: ${error.message}`, 'error');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'error');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'error');
    }
  }
}

async function postNextImage() {
  log('Preparing to post next image...');
  if (imageFiles.length === 0) {
    log('No images found. Reloading image files...');
    await loadImageFiles();
    if (imageFiles.length === 0) {
      log('Still no images found. Skipping this post.', 'warn');
      return;
    }
  }

  const imagePath = path.join(config.imageFolder, imageFiles[currentIndex]);
  log(`Selected image: ${imagePath}`);
  await postImageToFediverse(imagePath);

  // Remove the posted image from the array
  imageFiles.splice(currentIndex, 1);
  // If we've posted all images, reset the index; otherwise, use the same index for the next image
  if (imageFiles.length === 0) {
    currentIndex = 0;
  } else {
    currentIndex = currentIndex % imageFiles.length;
  }
  log(`Updated current index to ${currentIndex}. Remaining images: ${imageFiles.length}`);
}

async function start() {
  log('Starting Fediverse Image Poster');
  log(`Configuration: ${JSON.stringify({ ...config, accessToken: '[REDACTED]' })}`);
  
  await loadImageFiles();
  
  log('Posting first image immediately');
  await postNextImage();

  log(`Setting up interval to post every ${config.postInterval / 60000} minutes`);
  setInterval(postNextImage, config.postInterval);
}

process.on('SIGINT', () => {
  log('Received SIGINT. Shutting down gracefully.');
  process.exit(0);
});

start();