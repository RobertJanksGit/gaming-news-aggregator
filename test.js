const fetch = require("node-fetch");

const BASE_URL = "http://localhost:3000";

async function testAPI() {
  try {
    // Test health endpoint
    console.log("\nTesting health endpoint...");
    const healthResponse = await fetch(`${BASE_URL}/health`);
    const healthData = await healthResponse.json();
    console.log("Health check response:", healthData);

    // Test news endpoint
    console.log("\nTesting news endpoint...");
    console.log("This may take a few minutes as it processes articles...");
    const newsResponse = await fetch(`${BASE_URL}/api/news`);
    const newsData = await newsResponse.json();
    console.log("\nNews API Response:");
    console.log("Status:", newsData.status);
    console.log("Message:", newsData.message);
    console.log("\nArticles found:", newsData.data?.length || 0);

    if (newsData.data && newsData.data.length > 0) {
      console.log("\nFirst article preview:");
      console.log("Title:", newsData.data[0].title);
      console.log("Summary:", newsData.data[0].summary);
      console.log("Source:", newsData.data[0].sourceUrl);
      console.log("Social:", newsData.data[0].socialUrl || "None");
    }
  } catch (error) {
    console.error("Error testing API:", error);
  }
}

// Run the tests
testAPI();
