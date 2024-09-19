// 1. IMPORT REQUIRED MODULES
const express = require('express');
const path = require('path'); // Added to handle file paths
require('dotenv').config() // For using environment variables
const cors = require('cors'); // Import cors package
const fs = require('fs');
const LLP_PROVIDERS = require('./llpProviders'); // for which AI provider used
const axios = require('axios'); // Used to make HTTP requests to Auth0

// Fix for "session is not defined" error
const { auth, requiresAuth } = require('express-openid-connect');
const session = require('express-session'); // manages user sessions and helps maintain user state across requests

// 2. VARIABLE DECLARATIONS AND ASSIGNMENTS
const app = express(); // Create an instance of Express
const PORT = process.env.PORT || 3000; // Define the port for the server to listen on 

// Auth0 config
const config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.SESSION_SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  //clientSecret: process.env.SESSION_SECRET, // no funciona con este

  authorizationParams: {
    response_type: 'code',
    scope: 'openid profile email'
  },
};

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


  // Authentication middleware
  
  // Session middleware - sets up session management for maintaining user state
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' } // sent only over secure HTTPS connections (in production)
  }));

  // Auth0 middleware
  app.use(auth(config));
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


  // Auth0 routes

  // Test route
  // will return the user's profile information when they log in
  app.get('/profile', (req, res) => {
    console.log('profile test log line');
    //console.log('Request headers (/profile):', req.headers);

    console.log('!! req.oidc.idToken (/profile)', req.oidc.idToken);
    console.log('!! req.oidc.accessToken (/profile)', req.oidc.accessToken);

    res.send(JSON.stringify(req.oidc.user));
  });

  // Login endpoint
  // initiates the Auth0 login process
  // # This line sets up what happens when the server gets a request to the '/loginnn' URL.
  // # When someone tries to visit the '/loginnn' URL, this is the starting point for logging them in.
  app.get('/loginnn', (req, res) => {
    console.log('login test log line');    
    //console.log('Request body (login):', req.body);
    //console.log('Request headers (login):', req.headers);

    //res.oidc.login({ returnTo: '/profile' });   

    //res.oidc.login({ returnTo: 'http://localhost:5222?id_token=' + req.oidc.idToken });

    // # This grabs a special token (ID token) tied to the user's identity from the request.
    // # The server checks that it has the user’s identity token before moving forward.
    const idToken = req.oidc.idToken;
    
    // # The return URL (where the user goes after login) is built with their identity token included in the link.
    // # After the user logs in, they are sent to this URL along with their token for further processing.
    const returnUrl = 'http://localhost:5222?id_token=' + idToken;
    
    // # This tells the server to log the user in and then send them to the link we created with their token.
    // # The server finishes logging the user in and sends them back to the app with their identity info (token).
    res.oidc.login({ returnTo: returnUrl });

    //res.send('');
  });

  // Logout endpoint
  // handles user logout
  app.get('/logout', (req, res) => {
    res.oidc.logout({ returnTo: '/' });
  });

  // Token endpoint
  // returns the access token for logged-in user and 
  // ensures that only authenticated users can access tokens
  app.get('/token', (req, res) => {
    console.log('Token request received');
    console.log('Is authenticated:', req.oidc.isAuthenticated());
    //console.log('User:', req.oidc.user);
    console.log('Access token:', req.oidc.accessToken);
    //console.log('Request body (token):', req.body);
    console.log('Request headers (token):', req.headers);

    console.log('!! req.oidc.idToken (/token)', req.oidc.idToken);

    if (req.oidc.isAuthenticated()) {
      res.json({ access_token: req.oidc.accessToken });
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  });

  // Callback route
  // Handles the redirect after successful Auth0 authentication
  app.get('/callback', (req, res) => {
    
    console.log('Request body (callback):', req.body);
    console.log('Request headers (callback):', req.headers);

    res.redirect('/');
  });

  // Token refresh endpoint
  // refreshes the access token
  // (meaning to obtain  new access token w/o requiring  user to log in again)
  app.post('/refresh-token', async (req, res) => {
    console.log('Inside /refresh-token endpoint');

    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    try {
      const response = await axios.post(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: process.env.AUTH0_CLIENT_ID,
        client_secret: process.env.AUTH0_CLIENT_SECRET,
        refresh_token: refresh_token
      });

      res.json(response.data);
    } catch (error) {
      console.error('Error refreshing token:', error.response ? error.response.data : error.message);
      res.status(500).json({ error: 'Failed to refresh token' });
    }
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
  console.log("## req received: -------------------");
  
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



  
  console.log("## req.oidc.user (stringified): " + JSON.stringify(req.oidc.user));
  
  console.log("## req.oidc.isAuthenticated(): " + req.oidc.isAuthenticated());
  //console.log("## req.oidc (full object): " + JSON.stringify(req.oidc));
  
  //console.log("## req.oidc.idToken: " + req.oidc.idToken);  
  //console.log('Request headers:', req.headers);
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

          console.log("$$ response: -----------------------");
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