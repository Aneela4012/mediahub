const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

function nowIso() {
  return new Date().toISOString();
}

class CosmosRepository {
  constructor(options) {
    const endpoint = options.endpoint;
    const key = options.key;
    this.databaseName = options.databaseName || 'mediahubdb';
    this.containerNames = {
      images: options.imagesContainer || 'images',
      comments: options.commentsContainer || 'comments',
      ratings: options.ratingsContainer || 'ratings'
    };
    this.client = new CosmosClient({ endpoint, key });
  }

  async initialise() {
    const { database } = await this.client.databases.createIfNotExists({ id: this.databaseName });
    this.database = database;

    const imageContainer = await database.containers.createIfNotExists({
      id: this.containerNames.images,
      partitionKey: { paths: ['/creatorId'] }
    });
    const commentContainer = await database.containers.createIfNotExists({
      id: this.containerNames.comments,
      partitionKey: { paths: ['/imageId'] }
    });
    const ratingContainer = await database.containers.createIfNotExists({
      id: this.containerNames.ratings,
      partitionKey: { paths: ['/imageId'] }
    });

    this.images = imageContainer.container;
    this.comments = commentContainer.container;
    this.ratings = ratingContainer.container;
  }

  async createImage(data) {
    const item = {
      id: uuidv4(),
      type: 'image',
      title: data.title,
      caption: data.caption,
      location: data.location,
      people: data.people,
      creatorName: data.creatorName,
      creatorId: data.creatorId || 'creator-primary',
      blobName: data.blobName,
      contentType: data.contentType,
      originalFileName: data.originalFileName,
      storageProvider: data.storageProvider,
      createdAt: nowIso()
    };
    await this.images.items.create(item);
    return item;
  }

  async searchImages(query) {
    const q = (query || '').trim().toLowerCase();
    const sql = q
      ? {
          query: `SELECT * FROM c WHERE CONTAINS(LOWER(c.title), @q) OR CONTAINS(LOWER(c.caption), @q) OR CONTAINS(LOWER(c.location), @q) OR CONTAINS(LOWER(c.people), @q) OR CONTAINS(LOWER(c.creatorName), @q) ORDER BY c.createdAt DESC`,
          parameters: [{ name: '@q', value: q }]
        }
      : { query: 'SELECT * FROM c ORDER BY c.createdAt DESC' };

    const { resources } = await this.images.items.query(sql, { enableCrossPartitionQuery: true }).fetchAll();
    return resources;
  }

  async getImageById(id) {
    const { resources } = await this.images.items.query({
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }]
    }, { enableCrossPartitionQuery: true }).fetchAll();
    return resources[0] || null;
  }

  async createComment(imageId, data) {
    const item = {
      id: uuidv4(),
      imageId,
      name: data.name || 'Anonymous',
      comment: data.comment,
      createdAt: nowIso()
    };
    await this.comments.items.create(item);
    return item;
  }

  async listComments(imageId) {
    const { resources } = await this.comments.items.query({
      query: 'SELECT * FROM c WHERE c.imageId = @imageId ORDER BY c.createdAt DESC',
      parameters: [{ name: '@imageId', value: imageId }]
    }, { partitionKey: imageId }).fetchAll();
    return resources;
  }

  async createRating(imageId, data) {
    const item = {
      id: uuidv4(),
      imageId,
      name: data.name || 'Anonymous',
      rating: Number(data.rating),
      createdAt: nowIso()
    };
    await this.ratings.items.create(item);
    return item;
  }

  async listRatings(imageId) {
    const { resources } = await this.ratings.items.query({
      query: 'SELECT * FROM c WHERE c.imageId = @imageId',
      parameters: [{ name: '@imageId', value: imageId }]
    }, { partitionKey: imageId }).fetchAll();
    return resources;
  }
}

class LocalRepository {
  constructor() {
    this.images = [];
    this.comments = [];
    this.ratings = [];
  }

  async initialise() {}

  async createImage(data) {
    const item = {
      id: uuidv4(),
      type: 'image',
      title: data.title,
      caption: data.caption,
      location: data.location,
      people: data.people,
      creatorName: data.creatorName,
      creatorId: data.creatorId || 'creator-primary',
      blobName: data.blobName,
      contentType: data.contentType,
      originalFileName: data.originalFileName,
      storageProvider: data.storageProvider,
      createdAt: nowIso()
    };
    this.images.unshift(item);
    return item;
  }

  async searchImages(query) {
    const q = (query || '').trim().toLowerCase();
    const sorted = [...this.images].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!q) return sorted;
    return sorted.filter((img) =>
      [img.title, img.caption, img.location, img.people, img.creatorName]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }

  async getImageById(id) {
    return this.images.find((img) => img.id === id) || null;
  }

  async createComment(imageId, data) {
    const item = {
      id: uuidv4(),
      imageId,
      name: data.name || 'Anonymous',
      comment: data.comment,
      createdAt: nowIso()
    };
    this.comments.unshift(item);
    return item;
  }

  async listComments(imageId) {
    return this.comments.filter((c) => c.imageId === imageId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createRating(imageId, data) {
    const item = {
      id: uuidv4(),
      imageId,
      name: data.name || 'Anonymous',
      rating: Number(data.rating),
      createdAt: nowIso()
    };
    this.ratings.unshift(item);
    return item;
  }

  async listRatings(imageId) {
    return this.ratings.filter((r) => r.imageId === imageId);
  }
}

function buildRepository() {
  if (process.env.COSMOS_ENDPOINT && process.env.COSMOS_KEY) {
    return new CosmosRepository({
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY,
      databaseName: process.env.COSMOS_DATABASE_NAME,
      imagesContainer: process.env.COSMOS_IMAGES_CONTAINER,
      commentsContainer: process.env.COSMOS_COMMENTS_CONTAINER,
      ratingsContainer: process.env.COSMOS_RATINGS_CONTAINER
    });
  }
  return new LocalRepository();
}

function ratingStats(ratings) {
  if (!ratings || ratings.length === 0) {
    return { count: 0, average: 0 };
  }
  const total = ratings.reduce((sum, r) => sum + Number(r.rating || 0), 0);
  return { count: ratings.length, average: Math.round((total / ratings.length) * 10) / 10 };
}

module.exports = { buildRepository, ratingStats, CosmosRepository, LocalRepository };
