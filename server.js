// Import required modules
const express = require('express');
const path = require('path'); // Added to handle file paths
require('dotenv').config() // For using environment variables
const cors = require('cors'); // Import cors package

// Create an instance of Express
const app = express();	

// CORS
// A Otherwise requests from a browser don't work
// Configuration
const ALLOWED_ORIGIN_DOMAIN = readFileContents("ALLOWED_ORIGIN");

const corsOptions = {  
  origin: [ALLOWED_ORIGIN_DOMAIN], // Specify the ONLY origins allowed
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
// Use its middleware
app.use(cors(corsOptions));
// Add custom middleware to ensure cors headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Use express's built-in JSON parsing middleware
// (using equivalent functionality to 'body-parser' -another module that you'd have to install- but within express)
app.use(express.json()); 

// Serve static files from the app directory
app.use(express.static(path.join(__dirname, 'app'))); // Added to serve static files

// Define a route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html')); // Changed to send the HTML file
});

const OPENAI_API_KEY_VALUE = readFileContents("OPENAI_API_KEY");

// Use Post instead of Get
  // Both in client and in server
  // (F, gpt/claude) For reasons of Data length, Special characters & Security
// Also ensure route below matches exactly with my (unity) client's endpoint
app.post('/my-gpt-endpoint', async (req, res, next) => { // Error handling as per Fer's system (1/3)
    
  console.log("## req received --------------------");
  console.log("## req.body - message: " + JSON.stringify(req.body.message));
  console.log("## req.body - sPlatformSentFrom: " + req.body.sPlatformSentFrom);
  console.log("## ---------------------------------");
  
  const myText = req.body.message; // access message from request body
  let openAiResponseToShow = '';

  if (myText) {
    try {
        const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY_VALUE}`,
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo', //'gpt-4',
                messages: [{ role: 'user', content: myText }],
                temperature: 1.0,
                top_p: 0.7,
                n: 1,
                stream: false,
                presence_penalty: 0,
                frequency_penalty: 0,
            }),
        });

        if (openAiResponse.ok) {
            const data = await openAiResponse.json();
            openAiResponseToShow = data.choices[0].message.content;
        } else {
          const data = await openAiResponse.json();
          openAiResponseToShow = 'Error: Unable to process your request 1. Open AI response: ' + JSON.stringify(data);
        }
    } catch (error) {
        console.error(error);
        openAiResponseToShow = 'Error: Unable to process your request 2. Error: ' +JSON.stringify(error);
    }

    // Send the response to the client
    res.send(openAiResponseToShow);

  } else {
    // Error handling if message missing
    // May also send an error message to client!

    // Error handling as per Fer's system (2/3)
    const error = new Error('Error: No message provided in the request body');
    error.status = 400;
    next(error); // should send execution to "handler" below
  }  
});

// Error handling as per Fer's system (3/3)
// A: handles the "next" calls from errors above
app.use((err, req, res, next) => {
  console.log("Inside error -Next- middleware for handling errors");
  res.status(err.status || 500).json({ error: err.message });   
});

function readFileContents(fileName) { // to use to extract open ai api from its file
  
  const fs = require('node:fs');

  try {
    const data = fs.readFileSync(fileName, 'utf8');    
    return data;
  } catch (err) {
    console.error(err);
  }
}

// Define the port for the server to listen on
const PORT = process.env.PORT || 3000;

console.log(`Hello from the server`);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);  
  if (process.env.HOST === 'localhost' || process.env.HOST === undefined) {    
    console.log('Local server: Go to http://localhost:' + PORT)
  }  
});