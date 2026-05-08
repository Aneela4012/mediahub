require('dotenv').config();

// Application Insights is optional. It is initialised before Express so request/dependency tracking is captured.
const appInsightsConnection = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || process.env.APPINSIGHTS_CONNECTION_STRING;
let appInsightsEnabled = false;
if (appInsightsConnection) {
  try {
    const appInsights = require('applicationinsights');
    appInsights.setup(appInsightsConnection)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true)
      .start();
    appInsightsEnabled = true;
  } catch (error) {
    console.warn('Application Insights could not be started. The app will continue without telemetry.', error.message);
  }
}

const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { buildRepository, ratingStats } = require('./src/repository');
const { buildMediaStore } = require('./src/azureBlobMediaStore');

const app = express();
app.set('trust proxy', 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  }
});

const repository = buildRepository();
const mediaStore = buildMediaStore();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'development-secret-change-in-azure',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Kept off by default to avoid login-cookie issues on first Azure test; set SESSION_COOKIE_SECURE=true when HTTPS-only is enforced.
    secure: process.env.SESSION_COOKIE_SECURE === 'true'
  }
}));

function isCreator(req) {
  return req.session && req.session.role === 'creator';
}

function requireCreator(req, res, next) {
  if (!isCreator(req)) return res.redirect('/creator/login');
  next();
}

function addImageUrls(images) {
  return images.map((image) => ({
    ...image,
    imageUrl: mediaStore.getUrl(image.blobName)
  }));
}

function cleanText(value, fallback = '') {
  return String(value || fallback).trim();
}

function redirectWithMessage(res, pathName, key, message) {
  const separator = pathName.includes('?') ? '&' : '?';
  return res.redirect(`${pathName}${separator}${key}=${encodeURIComponent(message)}`);
}

function deploymentMode() {
  const usingCosmos = Boolean(process.env.COSMOS_ENDPOINT && process.env.COSMOS_KEY);
  const usingBlob = Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING && process.env.AZURE_STORAGE_CONTAINER_NAME);
  return {
    database: usingCosmos ? 'Database: Azure Cosmos DB' : 'Database: local in-memory fallback',
    storage: usingBlob ? 'Storage: Azure Blob Storage' : 'Storage: local file fallback',
    databaseProvider: usingCosmos ? 'azure-cosmos-db' : 'local-memory',
    storageProvider: usingBlob ? 'azure-blob-storage' : 'local-files',
    fullyCloudConnected: usingCosmos && usingBlob
  };
}

app.get('/', async (req, res, next) => {
  try {
    const q = cleanText(req.query.q);
    const images = addImageUrls(await repository.searchImages(q));
    res.render('index', {
      title: 'MediaHub Cloud',
      images,
      q,
      isCreator: isCreator(req),
      message: req.query.message || ''
    });
  } catch (error) {
    next(error);
  }
});

app.get('/creator/login', (req, res) => {
  res.render('creator-login', {
    title: 'Creator Login',
    error: req.query.error || '',
    isCreator: isCreator(req)
  });
});

app.post('/creator/login', (req, res) => {
  const code = cleanText(req.body.creatorCode);
  const expected = process.env.CREATOR_CODE || 'creator123';
  if (code !== expected) {
    return redirectWithMessage(res, '/creator/login', 'error', 'Invalid creator access code');
  }
  req.session.role = 'creator';
  req.session.creatorName = cleanText(req.body.creatorName, 'Creator');
  res.redirect('/creator');
});

app.post('/creator/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/creator', requireCreator, async (req, res, next) => {
  try {
    const images = addImageUrls(await repository.searchImages(''));
    res.render('creator', {
      title: 'Creator Dashboard',
      images,
      isCreator: true,
      creatorName: req.session.creatorName || 'Creator',
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (error) {
    next(error);
  }
});

app.post('/creator/upload', requireCreator, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return redirectWithMessage(res, '/creator', 'error', 'Please select an image file');
    }

    const title = cleanText(req.body.title);
    const caption = cleanText(req.body.caption);
    const location = cleanText(req.body.location);
    const people = cleanText(req.body.people);

    if (!title || !caption) {
      return redirectWithMessage(res, '/creator', 'error', 'Title and caption are required');
    }

    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const safeName = `${Date.now()}-${uuidv4()}${extension}`;
    const uploaded = await mediaStore.upload(req.file.buffer, safeName, req.file.mimetype);

    const image = await repository.createImage({
      title,
      caption,
      location,
      people,
      creatorName: req.session.creatorName || 'Creator',
      creatorId: 'creator-primary',
      blobName: uploaded.blobName,
      storageProvider: uploaded.storageProvider,
      contentType: req.file.mimetype,
      originalFileName: req.file.originalname
    });

    redirectWithMessage(res, `/image/${image.id}`, 'message', 'Image uploaded successfully');
  } catch (error) {
    next(error);
  }
});

app.get('/image/:id', async (req, res, next) => {
  try {
    const image = await repository.getImageById(req.params.id);
    if (!image) return res.status(404).render('error', { title: 'Not Found', message: 'Image not found', isCreator: isCreator(req) });

    const comments = await repository.listComments(image.id);
    const ratings = await repository.listRatings(image.id);
    const stats = ratingStats(ratings);

    res.render('image-detail', {
      title: image.title,
      image: { ...image, imageUrl: mediaStore.getUrl(image.blobName) },
      comments,
      stats,
      isCreator: isCreator(req),
      message: req.query.message || '',
      error: req.query.error || ''
    });
  } catch (error) {
    next(error);
  }
});

app.post('/image/:id/comment', async (req, res, next) => {
  try {
    const image = await repository.getImageById(req.params.id);
    if (!image) return redirectWithMessage(res, '/', 'message', 'Image not found');

    const comment = cleanText(req.body.comment);
    if (!comment) return redirectWithMessage(res, `/image/${image.id}`, 'error', 'Comment cannot be empty');

    await repository.createComment(image.id, {
      name: cleanText(req.body.name, 'Anonymous'),
      comment
    });
    redirectWithMessage(res, `/image/${image.id}`, 'message', 'Comment added');
  } catch (error) {
    next(error);
  }
});

app.post('/image/:id/rate', async (req, res, next) => {
  try {
    const image = await repository.getImageById(req.params.id);
    if (!image) return redirectWithMessage(res, '/', 'message', 'Image not found');

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return redirectWithMessage(res, `/image/${image.id}`, 'error', 'Rating must be between 1 and 5');
    }

    await repository.createRating(image.id, {
      name: cleanText(req.body.name, 'Anonymous'),
      rating
    });
    redirectWithMessage(res, `/image/${image.id}`, 'message', 'Rating submitted');
  } catch (error) {
    next(error);
  }
});

app.get('/api/images', async (req, res, next) => {
  try {
    const images = addImageUrls(await repository.searchImages(req.query.q));
    res.json({ count: images.length, images });
  } catch (error) {
    next(error);
  }
});

app.get('/api/images/:id', async (req, res, next) => {
  try {
    const image = await repository.getImageById(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    const comments = await repository.listComments(image.id);
    const ratings = await repository.listRatings(image.id);
    res.json({ image: { ...image, imageUrl: mediaStore.getUrl(image.blobName) }, comments, ratingStats: ratingStats(ratings) });
  } catch (error) {
    next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'MediaHub Cloud',
    ...deploymentMode(),
    appInsights: appInsightsEnabled,
    timestamp: new Date().toISOString()
  });
});

app.get('/architecture', (req, res) => {
  res.render('architecture', {
    title: 'Architecture Evidence',
    isCreator: isCreator(req),
    mode: deploymentMode(),
    appInsights: appInsightsEnabled
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  const message = err.message || 'Unexpected server error';
  res.status(500).render('error', { title: 'Server Error', message, isCreator: isCreator(req) });
});

async function start() {
  await repository.initialise();
  await mediaStore.initialise();

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`MediaHub Cloud running on port ${port}`);
    console.log(`Mode: ${deploymentMode().fullyCloudConnected ? 'Azure cloud mode' : 'Partial/local mode'}`);
  });
}

start().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
