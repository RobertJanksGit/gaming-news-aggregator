require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const { OpenAI } = require("openai");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");
const fetch = require("node-fetch");
const cron = require("node-cron");

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Increase JSON payload limit to 50mb
app.use(express.json({ limit: "50mb" }));
// Increase URL-encoded payload limit to 50mb
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize RSS parser
const parser = new Parser();

// RSS feed URLs
const RSS_FEEDS = [
  "https://feeds.feedburner.com/ign/all", // IGN's main feed
  "https://www.gamespot.com/feeds/game-news", // GameSpot news feed
  "https://www.polygon.com/rss/index.xml", // Polygon feed
  "https://kotaku.com/feed/rss", // Kotaku feed
  "https://www.eurogamer.net/feed", // Eurogamer feed
  "https://www.pcgamer.com/rss", // PC Gamer feed
  "https://www.rockpapershotgun.com/feed", // Rock Paper Shotgun feed
  "https://www.vg247.com/feed", // VG247 feed
];

// Cache for storing processed articles
let articleCache = {
  timestamp: null,
  data: null,
  isProcessing: false,
};

// Get articles from RSS feeds
async function getLatestArticles() {
  const allArticles = [];
  console.log("Starting to fetch articles from RSS feeds...");

  const currentDate = new Date();
  const startOfDay = new Date(currentDate);
  startOfDay.setHours(0, 0, 0, 0);

  console.log(`Current time: ${currentDate.toISOString()}`);
  console.log(`Start of day: ${startOfDay.toISOString()}`);

  for (const feedUrl of RSS_FEEDS) {
    try {
      console.log(`\nAttempting to parse feed: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      console.log(`Successfully parsed feed: ${feedUrl}`);
      console.log(`Found ${feed.items.length} total items in feed`);

      // Log the first few items' dates for debugging
      console.log("\nSample article dates from feed:");
      feed.items.slice(0, 3).forEach((item) => {
        console.log(`Title: ${item.title}`);
        console.log(`Published: ${item.pubDate}`);
        console.log(`Parsed date: ${new Date(item.pubDate).toISOString()}\n`);
      });

      const filteredArticles = feed.items
        .filter((item) => {
          const pubDate = new Date(item.pubDate);
          const isToday = pubDate >= startOfDay;
          if (isToday) {
            console.log(
              `Including article: ${item.title} (${pubDate.toISOString()})`
            );
          }
          return isToday;
        })
        .map((item) => ({
          title: item.title,
          description: item.contentSnippet || item.description || "",
          link: item.link,
          pubDate: new Date(item.pubDate),
          source: feed.title || new URL(feedUrl).hostname,
        }));

      console.log(
        `Found ${filteredArticles.length} articles from today on ${
          feed.title || feedUrl
        }`
      );
      allArticles.push(...filteredArticles);
    } catch (err) {
      console.error(`Error parsing RSS feed from ${feedUrl}:`, err.message);
    }
  }

  // Remove duplicates by URL
  const uniqueArticles = Array.from(
    new Set(allArticles.map((item) => item.link))
  ).map((url) => allArticles.find((item) => item.link === url));

  console.log("\nFeed parsing summary:");
  console.log(`Total articles found: ${allArticles.length}`);
  console.log(`Unique articles after deduplication: ${uniqueArticles.length}`);

  // Log articles by source with their dates
  console.log("\nArticles by source with dates:");
  uniqueArticles.forEach((article) => {
    console.log(
      `${article.source}: ${article.title} (${article.pubDate.toISOString()})`
    );
  });

  return uniqueArticles;
}

// Filter interesting articles using OpenAI
async function filterArticles(articles, numToSelect = 5) {
  if (articles.length === 0) return [];

  try {
    const articleList = articles
      .map(
        (article) =>
          `Title: ${article.title}\nSummary: ${article.description}\nURL: ${article.link}`
      )
      .join("\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a video game news curator. Select the most interesting and impactful gaming news stories.",
        },
        {
          role: "user",
          content: `Select the ${numToSelect} most interesting articles from this list. Return ONLY a JSON array of objects with 'title' and 'url' properties. Choose articles that are most impactful or newsworthy.\n\n${articleList}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.articles || [];
  } catch (err) {
    console.error("Error filtering articles with OpenAI:", err);
    return [];
  }
}

// Extract article image
async function getArticleImage(dom, url) {
  try {
    const document = dom.window.document;
    let imageUrl = null;

    // Try to find the main image using common patterns
    const selectors = [
      'meta[property="og:image"]', // Open Graph image
      'meta[name="twitter:image"]', // Twitter image
      'meta[property="og:image:secure_url"]', // Secure Open Graph image
      "article img", // First image in article
      ".article-image img", // Common article image class
      ".post-image img", // Common post image class
      ".entry-image img", // Common entry image class
      ".featured-image img", // Featured image
      "figure img", // Images in figure elements
      ".main-image img", // Main image class
      "#main-image", // Main image ID
      'img[itemprop="image"]', // Schema.org image
    ];

    // Try each selector until we find an image
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        // Get src from img tag or content from meta tag
        imageUrl = element.src || element.content;
        if (imageUrl) break;
      }
    }

    // If no image found, try getting the first large image
    if (!imageUrl) {
      const images = Array.from(document.getElementsByTagName("img"));
      const largeImage = images.find((img) => {
        const width = parseInt(img.getAttribute("width") || "0");
        const height = parseInt(img.getAttribute("height") || "0");
        return (
          (width >= 300 && height >= 200) ||
          (img.naturalWidth >= 300 && img.naturalHeight >= 200)
        );
      });
      if (largeImage) imageUrl = largeImage.src;
    }

    // Make sure the URL is absolute
    if (imageUrl) {
      try {
        imageUrl = new URL(imageUrl, url).href;
      } catch (e) {
        console.error("Error converting image URL to absolute:", e);
        return null;
      }
    }

    return imageUrl;
  } catch (err) {
    console.error(`Error extracting image from article:`, err);
    return null;
  }
}

// Extract full article text and image
async function getArticleContent(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) return null;

    // Get the image URL
    const imageUrl = await getArticleImage(dom, url);

    // Limit article text to ~4000 words to stay within OpenAI's token limits
    const words = article.textContent.split(/\s+/);
    const truncatedText = words.slice(0, 4000).join(" ");

    // Remove extra whitespace and normalize text
    return {
      text: truncatedText.replace(/\s+/g, " ").replace(/\n+/g, "\n").trim(),
      imageUrl: imageUrl,
    };
  } catch (err) {
    console.error(`Error extracting content from ${url}:`, err);
    return null;
  }
}

// Detect gaming platforms from text
async function detectPlatforms(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a gaming platform detector. Analyze the text and identify ALL gaming platforms that are relevant or mentioned.
            Consider both explicit mentions and context clues. Include all platforms that the news might be relevant for.
            
            Platform detection rules:
            - For console generations, include both current and previous gen (e.g., PS5 and PS4 = "PlayStation")
            - Include all platforms where the game/news would be relevant
            - If a game is typically released on all major platforms, include all of them
            - For PC-related news, include "PC"
            - For console-specific news, include the relevant console(s)
            - For VR news, include both "VR" and the related platforms (e.g., PSVR = "PlayStation" and "VR")
            
            Return ONLY a JSON object with a 'platforms' array containing platform names from these options:
            ["Nintendo", "PlayStation", "Xbox", "PC", "VR", "Mobile"]
            
            The array MUST include at least one platform - never return empty or use "Multi-platform".`,
        },
        {
          role: "user",
          content: `Analyze this text and list ALL relevant gaming platforms:\n\n${text}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 150,
    });

    const result = JSON.parse(response.choices[0].message.content);
    // If no platforms detected, return all major platforms as it's likely a general gaming news
    if (!result.platforms || result.platforms.length === 0) {
      return ["PlayStation", "Xbox", "Nintendo", "PC"];
    }
    return result.platforms;
  } catch (err) {
    console.error("Error detecting platforms:", err);
    // Default to all major platforms if there's an error
    return ["PlayStation", "Xbox", "Nintendo", "PC"];
  }
}

// Summarize article using OpenAI
async function summarizeArticle(fullText, url) {
  try {
    // Split text into chunks of approximately 8000 characters
    const chunkSize = 8000;
    const chunks = [];

    for (let i = 0; i < fullText.length; i += chunkSize) {
      chunks.push(fullText.slice(i, i + chunkSize));
    }

    // Get initial summary for each chunk
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1} of ${chunks.length}`);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a video game news summarizer. Create concise summaries of article segments.",
          },
          {
            role: "user",
            content: `Summarize this article segment. Keep it brief and focused on key points only.\n\n${chunks[i]}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 250,
      });

      const summary = response.choices[0].message.content;
      chunkSummaries.push(summary);

      // Add a small delay between chunks to avoid rate limits
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Combine chunk summaries and create final summary with title
    const combinedSummary = chunkSummaries.join(" ");

    // Detect platforms from the combined summary
    const platforms = await detectPlatforms(combinedSummary);

    const finalResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a video game news summarizer. Create engaging summaries with catchy titles.",
        },
        {
          role: "user",
          content: `Create a final summary and catchy title from these combined article summaries. Include a reference to the source (${url}). Return ONLY a JSON object with 'title' and 'summary' properties.\n\n${combinedSummary}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 500,
    });

    const summary = JSON.parse(finalResponse.choices[0].message.content);
    return {
      ...summary,
      platforms: platforms,
    };
  } catch (err) {
    console.error("Error summarizing article with OpenAI:", err);
    return null;
  }
}

// Main process
async function processGameNews() {
  console.log("Starting game news processing...");

  // Check cache (valid for 1 hour)
  const now = new Date();
  if (articleCache.timestamp && articleCache.data) {
    const cacheAge = now - articleCache.timestamp;
    if (cacheAge < 3600000) {
      // 1 hour in milliseconds
      console.log("Returning cached results");
      return articleCache.data;
    }
  }

  try {
    // Get latest articles
    const articles = await getLatestArticles();
    console.log(`Found ${articles.length} articles from today`);

    if (articles.length === 0) {
      const result = {
        status: "success",
        message: "No articles found for today",
        data: [],
      };
      articleCache = { timestamp: now, data: result };
      return result;
    }

    // Filter interesting articles
    const selectedArticles = await filterArticles(articles);
    console.log(`Selected ${selectedArticles.length} interesting articles`);

    // Process articles in batches of 2
    const summaries = [];
    const batchSize = 2;

    for (let i = 0; i < selectedArticles.length; i += batchSize) {
      const batch = selectedArticles.slice(i, i + batchSize);
      console.log(
        `Processing batch ${i / batchSize + 1} of ${Math.ceil(
          selectedArticles.length / batchSize
        )}`
      );

      // Process batch concurrently
      const batchPromises = batch.map(async (article) => {
        try {
          console.log(`Processing article: ${article.title}`);
          const content = await getArticleContent(article.url);

          if (!content) {
            console.log(`Couldn't extract content from ${article.url}`);
            return null;
          }

          const summary = await summarizeArticle(content.text, article.url);
          if (summary) {
            return {
              ...summary,
              sourceUrl: article.url,
              imageUrl: content.imageUrl,
            };
          }
          return null;
        } catch (error) {
          console.error(`Error processing article ${article.url}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      summaries.push(...batchResults.filter(Boolean));

      // Add a small delay between batches to avoid rate limits
      if (i + batchSize < selectedArticles.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const result = {
      status: "success",
      message: `Successfully processed ${summaries.length} articles`,
      data: summaries,
    };

    // Update cache
    articleCache = { timestamp: now, data: result };
    return result;
  } catch (error) {
    console.error("Error processing game news:", error);
    return {
      status: "error",
      message: "Error processing game news",
      error: error.message,
    };
  }
}

// API Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Welcome to the Gaming News API",
    endpoints: {
      "/health": "Check API health",
      "/api/news": "Get today's gaming news",
    },
  });
});

app.get("/api/news", async (req, res) => {
  try {
    console.log("Received request for /api/news");

    // If already processing, return status
    if (articleCache.isProcessing) {
      return res.json({
        status: "processing",
        message:
          "News articles are being processed. Please try again in a few minutes.",
      });
    }

    // Start processing
    console.log("Starting news processing...");
    articleCache.isProcessing = true;

    const result = await processGameNews();
    articleCache.data = result;
    articleCache.timestamp = new Date();
    articleCache.isProcessing = false;

    console.log("News processing completed");
    res.json(result);
  } catch (error) {
    console.error("Error in /api/news endpoint:", error);
    articleCache.isProcessing = false;
    res.status(500).json({
      error: "Internal server error",
      message: "An error occurred while processing the news",
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("API endpoints:");
  console.log("- GET /health: Check server status");
  console.log("- GET /api/news: Get today's summarized game news");
});
