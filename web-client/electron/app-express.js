const express = require('express');
// const cors = require('cors');
const app = express();
const port = 3001;

// app.use(cors());

// Sample /products endpoint
app.get('/products', (req, res) => {
  res.json({ message: 'List of products' });
});

// Sample OpenAI-compatible endpoint
app.post('/openai', (req, res) => {
  // Your OpenAI-compatible logic here
  res.json({ message: 'OpenAI-compatible endpoint' });
});

app.listen(port, () => {
  console.log(`Express server running at http://localhost:${port}`);
});