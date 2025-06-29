const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const genAI = require("@google/generative-ai");
const csvtojson = require('csvtojson');

dotenv.config();
const app = express();
const PORT = 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// -------------------- MongoDB Connection --------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// -------------------- MongoDB Schema --------------------
const ImageSchema = new mongoose.Schema({
  id: Number,
  gender: String,
  masterCategory: String,
  subCategory: String,
  articleType: String,
  baseColour: String,
  season: String,
  year: Number,
  usage: String,
  productDisplayName: String,
  imageFile: String
});
const Image = mongoose.model('Image', ImageSchema);

// -------------------- Middleware --------------------
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// -------------------- Optional: Insert CSV to MongoDB --------------------
if (process.env.INSERT_CSV === 'true') {
  csvtojson()
    .fromFile('imageData.csv')
    .then(async (json) => {
      const dataWithImage = json.map(item => ({
        ...item,
        id: Number(item.id),
        year: Number(item.year),
        imageFile: `${item.id}.jpg`
      }));
      await Image.insertMany(dataWithImage);
      console.log("✅ CSV data inserted with imageFile.");
    })
    .catch(err => console.error("❌ Error inserting CSV:", err));
}

// -------------------- Routes --------------------

// Home page with search
app.get('/', async (req, res) => {
  const query = req.query.q;
  let images = [];

  if (query) {
    const regex = new RegExp(query, 'i');
    images = await Image.find({
      $or: [
        { gender: regex },
        { masterCategory: regex },
        { subCategory: regex },
        { articleType: regex },
        { baseColour: regex },
        { season: regex },
        { usage: regex },
        { productDisplayName: regex }
      ]
    }).limit(30);
  } else {
    images = await Image.find().limit(30);
  }

  res.render('index', { images, query, suggestions: [] });
});

// -------------------- AI Search Route --------------------
app.post('/ai-search', async (req, res) => {
  const description = req.body.description;

  if (!description) {
    return res.send("Please enter a description.");
  }

  const prompt = `
You are a smart product assistant.
From the user's message, extract:
1. JSON filters
2. Suggest 3 product names based on that.

Respond ONLY in the format:

\`\`\`json
{
  "filters": {
    "articleType": "example",
    "baseColour": "example",
    "season": "example",
    "gender": "example",
    "usage": "example"
  },
  "suggestions": [
    "Product suggestion 1",
    "Product suggestion 2",
    "Product suggestion 3"
  ]
}
\`\`\`

User message: "${description}"
`;

  try {
    const ai = new genAI.GoogleGenerativeAI(GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: "models/gemini-1.5-flash" });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text().trim();

    let filters = {}, suggestions = [];

    try {
      const cleaned = text
        .replace(/```json/i, '')
        .replace(/```/, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      filters = parsed.filters || {};
      suggestions = parsed.suggestions || [];
    } catch (err) {
      console.error("❌ Failed to parse Gemini output:", text);
      return res.send("Could not understand AI response. Try a simpler description.");
    }

    const mongoQuery = {};
    for (let key in filters) {
      if (filters[key] && filters[key].toLowerCase() !== 'null') {
        mongoQuery[key] = new RegExp(filters[key], 'i');
      }
    }

    const images = await Image.find(mongoQuery).limit(30);
    res.render('index', { images, query: description, suggestions });

  } catch (error) {
    console.error("❌ Gemini API Error:", error);
    res.send("AI failed. Please try again later.");
  }
});


app.get('/cart', (req, res) => {
  res.render('cart');
});


// -------------------- Start Server --------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
