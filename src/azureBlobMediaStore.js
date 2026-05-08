const fs = require('fs');
const path = require('path');
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol
} = require('@azure/storage-blob');

function parseConnectionString(connectionString) {
  const parts = {};
  connectionString.split(';').forEach((part) => {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) parts[key] = rest.join('=');
  });
  return parts;
}

class AzureBlobMediaStore {
  constructor(connectionString, containerName) {
    if (!connectionString || !containerName) {
      throw new Error('Azure Blob Storage connection string and container name are required.');
    }
    this.connectionString = connectionString;
    this.containerName = containerName;
    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(containerName);

    const parsed = parseConnectionString(connectionString);
    this.accountName = parsed.AccountName;
    this.accountKey = parsed.AccountKey;
    this.blobEndpoint = parsed.BlobEndpoint || `https://${this.accountName}.blob.core.windows.net`;
    if (this.accountName && this.accountKey) {
      this.sharedKeyCredential = new StorageSharedKeyCredential(this.accountName, this.accountKey);
    }
  }

  async initialise() {
    await this.containerClient.createIfNotExists();
  }

  async upload(buffer, blobName, contentType) {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' }
    });
    return { blobName, storageProvider: 'azure-blob' };
  }

  getUrl(blobName) {
    if (!blobName) return '';
    const baseUrl = `${this.blobEndpoint}/${this.containerName}/${encodeURIComponent(blobName).replace(/%2F/g, '/')}`;

    // Prefer short-lived SAS URLs so the app works even when public blob access is disabled.
    if (!this.sharedKeyCredential) return baseUrl;

    const expiresOn = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    const sas = generateBlobSASQueryParameters({
      containerName: this.containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(Date.now() - 5 * 60 * 1000),
      expiresOn,
      protocol: SASProtocol.Https
    }, this.sharedKeyCredential).toString();

    return `${baseUrl}?${sas}`;
  }
}

class LocalMediaStore {
  constructor(uploadDir = path.join(__dirname, '..', 'public', 'uploads')) {
    this.uploadDir = uploadDir;
  }

  async initialise() {
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async upload(buffer, blobName) {
    const target = path.join(this.uploadDir, blobName);
    fs.writeFileSync(target, buffer);
    return { blobName, storageProvider: 'local' };
  }

  getUrl(blobName) {
    return `/uploads/${encodeURIComponent(blobName)}`;
  }
}

function buildMediaStore() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

  if (connectionString && containerName) {
    return new AzureBlobMediaStore(connectionString, containerName);
  }
  return new LocalMediaStore();
}

module.exports = { buildMediaStore, AzureBlobMediaStore, LocalMediaStore };
