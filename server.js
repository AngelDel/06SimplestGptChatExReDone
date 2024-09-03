// 1. IMPORT REQUIRED MODULES
const express = require('express');
const path = require('path'); // Added to handle file paths
require('dotenv').config() // For using environment variables
const cors = require('cors'); // Import cors package
const fs = require('fs');
const LLP_PROVIDERS = require('./llpProviders'); // for which AI provider used

// 2. VARIABLE DECLARATIONS AND ASSIGNMENTS
const app = express(); // Create an instance of Express
const PORT = process.env.PORT || 3000; // Define the port for the server to listen on 

// 3. MAIN EXECUTION
console.log(`Hello from the server`); // Executed when the file is first run
startServer();

// 4. FUNCTION DEFINITIONS
function setupMiddleware() {
  // CORS (1/2)
  // A: Otherwise requests from a browser don't work
  
  // configuration
  const ALLOWED_ORIGIN_DOMAIN = readFileContents("ALLOWED_ORIGIN");
  const corsOptions = {  
    origin: [ALLOWED_ORIGIN_DOMAIN], // Specify the ONLY origins allowed
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  // use
  app.use(cors(corsOptions));

  // Apply additional CORS headers as a fallback or for fine-grained control
  app.use(addCustomCorsHeaders);

  // Use express's built-in JSON parsing middleware
  // (using equivalent functionality to 'body-parser' -another module that you'd have to install- but within express)
  app.use(express.json());
  
  // Serve static files from the app directory
  app.use(express.static(path.join(__dirname, 'app')));
}

// CORS (2/2)
// Add custom middleware to ensure cors headers
function addCustomCorsHeaders(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
}

function setupRoutes() {
  const basePath = '/my-llp-endpoint';

  // Define a route
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app', 'index.html')); // Serve the HTML file
  });

  // Send request
  // Use Post instead of Get (both in client and in server)
  // (F, gpt/claude) For reasons of Data length, Special characters & Security
  // Also ensure route below matches exactly with my (unity) client's endpoint
  app.post(`${basePath}/completions`, handleCompletionRequest);


  // For fetching available models
  app.get(`${basePath}/available-models`, handleAvailableModelsRequest);  
  app.use(errorHandler);
}


async function handleAvailableModelsRequest(req, res, next) {
  console.log("Received request for available models");

  try {
    const OPENAI_API_KEY_VALUE = readFileContents("OPENAI_API_KEY");
    
     // For debugging, log that we're about to make a request to OpenAI
     console.log("Fetching models from OpenAI...");

    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY_VALUE}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error('Unable to fetch models from OpenAI. Response: ' + JSON.stringify(data));
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error(error);
    next(new Error('Unable to fetch available models. Error: ' + error.message));
  }
}

async function handleCompletionRequest(req, res, next) { // Error handling as per Fer's system -"Next"- (1/3)
  console.log("## req received --------------------");
  
  //console.log("## req.body - messages: " + JSON.stringify(req.body.Messages));
  console.log("## req.body - messages (" + req.body.Messages.length + "): ");
  for (const message of req.body.Messages) {    
    console.log(`    -${message.Role}: "${message.Content}"`);
  }

  console.log("## req.body - sPlatformSentFrom: " + req.body.SPlatformSentFrom);
  console.log("## req.body - llp provider: " + req.body.SLlpProvider);
  console.log("## req.body - temperature: " + req.body.Temperature);
  console.log("## req.body - model: " + req.body.Model);
  console.log("## ---------------------------------");

  try {    
    const allMyMessagesInLlpConversation = req.body.Messages; // Access message from request body
    const llpProvider = req.body.SLlpProvider;
    const myTemperature = req.body.Temperature;
    const myModel = req.body.Model;

    // Error handling
    // May also send an error message to client    

    // Validation for message array
    if (!allMyMessagesInLlpConversation || !Array.isArray(allMyMessagesInLlpConversation) || allMyMessagesInLlpConversation.length === 0) {
      // message missing    
      const validationError = new Error('No valid messages array provided in the request body');
      validationError.status = 400;
      throw validationError;
    }

    // Validation for each message object
    for (const message of allMyMessagesInLlpConversation) {
      if (!message.Role || typeof message.Role !== 'string') {
        const validationError = new Error('Invalid or missing role property in message object');
        validationError.status = 400;
        throw validationError;
      }
      if (!message.Content || typeof message.Content !== 'string') {
        const validationError = new Error('Invalid or missing content property in message object');
        validationError.status = 400;
        throw validationError;
      }
    }

    if (!llpProvider) {
      // llp provider missing    
      const validationError = new Error('No llp provider given in the request body');
      validationError.status = 400;
      throw validationError;
    }

    if (!myModel) {
      // model missing    
      const validationError = new Error('No model provided in the request body');
      validationError.status = 400;
      throw validationError;
    }    

    let llpResponse = "";
    
    switch (llpProvider) {
      case LLP_PROVIDERS.OPEN_AI:          
          llpResponse = await _callOpenAI(allMyMessagesInLlpConversation, myTemperature, myModel);

          console.log("$$ response ------------------------");
          //console.log("Raw JSON response from my server (and Open AI): " + JSON.stringify(llpResponse, null, 2));
          console.log("$$ message content from this server (and Open AI): '" + llpResponse.choices[0].message.content);
          console.log("$$ ---------------------------------");
          break;
      default: // Handle unknown platform                    
          const validationError = new Error('LLP provider not recognised');
          validationError.status = 400;
          throw validationError;
    }
    res.send(llpResponse); // Send the response to the client

  } catch (error) { // Error handling as per Fer's system (2/3)
    // Signals Express that an error occurred.
    // (Express will then invoke the appropriate error-handling middleware
    // when finished with the current middleware stack).
    next(error);
  }
}

// Extract env variables (eg: Open AI api key) from their files
function readFileContents(fileName) {
  try {
    return fs.readFileSync(fileName, 'utf8');
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Error handling as per Fer's system (3/3)
// A: takes care of the "Next" calls
function errorHandler(err, req, res, next) {  
  console.log("Inside error -Next- middleware for handling errors");
  res
    .status(err.status || 500)
    .json({ error: err.message, errorCode: 1224 });
}

function startServer() {
  setupMiddleware();
  setupRoutes();
  app.use(errorHandler);

  // Start the server and listen for incoming connections
  // (An asynchronous operation; the callback runs once the server is ready)
  app.listen(PORT, () => {
    console.log(`Env mode detected: ${process.env.NODE_ENV}`);
    console.log(`Server is running on port ${PORT}`);

    if (process.env.NODE_ENV !== 'production') {    
      console.log('Local server: Go to http://localhost:' + PORT);
    }
  });
}

//-

async function _callOpenAI(allMyMessagesInLlpConversation, temperature, model) {
  const OPENAI_API_KEY_VALUE = readFileContents("OPENAI_API_KEY");
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY_VALUE}`,
      },
      body: JSON.stringify({
        model: model,

        messages: allMyMessagesInLlpConversation.map(message => ({ // change messages format to match new input
          role: message.Role,
          content: message.Content
        })),

        temperature: temperature,
        top_p: 0.7,
        n: 1,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 0,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error('Unable to process your request (1). OpenAI response: ' + JSON.stringify(data));
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error(error);
    throw new Error('Unable to process your request (2). Error: ' + JSON.stringify(error));
  }
}