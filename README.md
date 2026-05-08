# MediaHub Cloud - Azure Deployment Guide

A ready-to-deploy cloud-native photo sharing web application designed for Azure App Service. It includes creator uploads, consumer viewing/searching, comments, ratings, REST routes, database persistence, object storage, environment variables, and monitoring readiness.

## Implemented functionality

### Creator view
- Creator login using an access code.
- Creator-only dashboard.
- Upload image files.
- Add metadata: title, caption, location, and people present.
- Uploaded media is stored in Azure Blob Storage when Azure variables are configured.
- Image metadata is stored in Azure Cosmos DB when Cosmos variables are configured.

### Consumer view
- Public gallery page.
- Search by title, caption, location, people, or creator.
- Image detail page.
- Add comments.
- Add 1-5 star ratings.
- Average rating is calculated and displayed.

### Backend / REST routes
- `/health` returns deployment health and cloud/local mode.
- `/api/images` returns image metadata as JSON.
- `/api/images/:id` returns one image, comments, and rating statistics as JSON.

### Cloud-native elements
- Azure App Service ready.
- Azure Cosmos DB ready.
- Azure Blob Storage ready.
- Application Insights ready.
- App settings/environment variables used for secrets.
- GitHub deployment compatible.

---

## Recommended Azure resources

1. **Azure App Service**
   - Runtime: Node.js 20 LTS
   - Deployment: GitHub / Deployment Center

2. **Azure Cosmos DB for NoSQL**
   - Database name: `mediahubdb`
   - Containers:
     - `images` with partition key `/creatorId`
     - `comments` with partition key `/imageId`
     - `ratings` with partition key `/imageId`

3. **Azure Storage Account**
   - Blob container: `media-images`
   - Public access is not required because the app generates temporary SAS image URLs.

4. **Application Insights**
   - Enable from the App Service monitoring tab.
   - Copy the connection string into App Service application settings if it is not automatically injected.

---

## Azure App Service environment variables

Add these in:

`Azure App Service > Settings > Environment variables / Configuration > Application settings`

```env
COSMOS_ENDPOINT=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-cosmos-primary-key
COSMOS_DATABASE_NAME=mediahubdb
COSMOS_IMAGES_CONTAINER=images
COSMOS_COMMENTS_CONTAINER=comments
COSMOS_RATINGS_CONTAINER=ratings

AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=yourstorage;AccountKey=yourkey;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER_NAME=media-images

APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
CREATOR_CODE=creator123
SESSION_SECRET=replace-this-with-a-long-random-secret
NODE_ENV=production
SESSION_COOKIE_SECURE=false
```

Restart the App Service after adding or changing settings.

> For a stricter HTTPS-only setup, set `SESSION_COOKIE_SECURE=true` after confirming the app is served through HTTPS. For the first deployment test, leave it as `false` to avoid login-cookie issues.

---

## Local run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Without Azure environment variables, the app runs in local test mode:
- Images are saved under `public/uploads`.
- Data is held in memory and resets when the app restarts.

For final deployment evidence, configure Cosmos DB and Blob Storage environment variables.

---

## GitHub to Azure App Service quick deployment

1. Create a new GitHub repository.
2. Push this project:

```bash
git init
git add .
git commit -m "Initial MediaHub Cloud app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

3. In Azure App Service:
   - Go to **Deployment Center**.
   - Select **GitHub**.
   - Select the repository and branch.
   - Save and wait for deployment.

4. Add environment variables.
5. Restart the App Service.
6. Open the App Service URL.

---

## 5-minute demonstration flow

1. Show GitHub repository and latest commit.
2. Show Azure App Service overview and deployed URL.
3. Open the web app home page.
4. Open creator login.
5. Login using the creator access code.
6. Upload an image with title, caption, location, and people metadata.
7. Open Azure Blob Storage and show the uploaded image object.
8. Open Cosmos DB Data Explorer and show the image metadata record.
9. Return to the app and show the consumer gallery.
10. Search for the uploaded image.
11. Open image detail page.
12. Add comment and rating.
13. Return to Cosmos DB and show comments/ratings containers.
14. Open `/health` and `/api/images`.
15. Open Application Insights and show request/performance information.

---

## Slide evidence points

- The app separates media objects from metadata.
- Blob Storage handles large unstructured image files.
- Cosmos DB stores scalable metadata, comments, and ratings.
- App Service hosts the REST-backed web application.
- GitHub deployment supports repeatable deployment.
- Environment variables avoid hardcoded secrets.
- Application Insights provides real performance and request information.
- Limitations: simple creator access code, no full production identity provider, no CDN layer, no AI media analysis.
- Improvements: Azure Entra ID, Azure Front Door/CDN, AI Vision tags, thumbnail generation, and load testing.

---

## Default creator login

Default access code:

```text
creator123
```

Change it using the `CREATOR_CODE` environment variable in Azure.
