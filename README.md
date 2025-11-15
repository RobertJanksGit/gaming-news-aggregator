# Gaming News Aggregator

An intelligent news aggregator that collects, filters, and summarizes gaming news articles using AI. The application scrapes news from major gaming websites, uses OpenAI to identify the most interesting stories, and provides concise summaries with platform information.

## Features

- Automatically scrapes news from major gaming websites (IGN, GameSpot, Polygon, etc.)
- Uses AI to filter and select the most interesting articles
- Generates concise summaries with catchy titles
- Identifies relevant gaming platforms for each article
- Extracts and includes article images
- Captures the first embedded X/Twitter or YouTube link when available
- Caches results to minimize API usage
- Runs on a scheduled basis (default: daily at 8 PM)
- RESTful API endpoints for easy integration

## Prerequisites

- Node.js (v14 or higher)
- OpenAI API key

## Installation

1. Clone the repository:

```bash
git clone <your-repository-url>
cd gaming-news-aggregator
```

2. Install dependencies:

```bash
npm install
```

3. Create a .env file in the root directory:

```bash
OPENAI_API_KEY=your-api-key-here
PORT=3000  # Optional, defaults to 3000
```

## Usage

Start the server:

```bash
npm start
```

The server will:

1. Start on the specified port (default: 3000)
2. Begin scraping and processing news articles
3. Schedule daily updates at 8 PM
4. Expose API endpoints for accessing the news

## API Endpoints

### Health Check

```
GET /health
```

Returns server status and timestamp.

### Get News Articles

```
GET /api/news
```

Returns processed news articles with summaries, platforms, and images.
Append `?refresh=true` (or `?refresh=1`) to bypass the 1-hour cache and force a new scrape.

Example response:

```json
{
  "status": "success",
  "message": "Successfully processed 5 articles",
  "data": [
    {
      "title": "Catchy Article Title",
      "summary": "Concise summary of the article...",
      "sourceUrl": "https://original.article.url",
      "imageUrl": "https://image.url",
      "socialUrl": "https://twitter.com/example/status/1234567890",
      "platforms": ["PlayStation", "Xbox", "PC"]
    }
  ]
}
```

## Configuration

The following can be configured in `index.js`:

- RSS feed sources (`RSS_FEEDS` array)
- Number of articles to select (`numToSelect` parameter)
- Scheduled run time (cron schedule)
- Cache duration (default: 1 hour)

## Deploying to Heroku (Puppeteer Support)

Puppeteer needs both extra system libraries **and** a Chromium binary inside the dyno.  
This repo already ships an `Aptfile` with the required libs—just make sure the buildpacks are stacked like this:

```bash
heroku buildpacks:add --index 1 heroku-community/apt
heroku buildpacks:add --index 2 jontewks/puppeteer
heroku buildpacks:add --index 3 heroku/nodejs
```

The `jontewks/puppeteer` buildpack downloads Chrome and exports `GOOGLE_CHROME_BIN`, which the app automatically uses when launching Puppeteer. After setting the buildpacks, redeploy (`git push heroku main`) so the new slug includes the browser; `socialUrl` extraction will then work in production.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- OpenAI for providing the AI capabilities
- RSS feeds from various gaming news websites
- Node.js and the amazing open-source community
