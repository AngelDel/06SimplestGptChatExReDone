const util = require('util');

// 1. IMPORT REQUIRED MODULES
const express = require('express');
const path = require('path'); // Added to handle file paths
require('dotenv').config() // For using environment variables
const cors = require('cors'); // Import cors package
const fs = require('fs');
const LLP_PROVIDERS = require('./llpProviders'); // for which AI provider used
const axios = require('axios'); // Used to make HTTP requests to Auth0
const crypto = require('crypto'); // Because Auth0 uses PKCE flow (Proof Key for Code Exchange), which requires a code_verifier

// jwt/jwks imports replaced with new Auth0-specific middleware (mentioned when you create a new Auth0 API))
//const jwt = require('jsonwebtoken');
//const jwks = require('jwks-rsa');
const { auth: validateAuth } = require('express-oauth2-jwt-bearer');

// Fix for "session is not defined" error
const { auth } = require('express-openid-connect');
const session = require('express-session'); // manages user sessions and helps maintain user state across requests

// 2. VARIABLE DECLARATIONS AND ASSIGNMENTS
const app = express(); // Create an instance of Express
const PORT = process.env.PORT || 3000; // Define the port for the server to listen on 

let pkceStore = {}; // Store PKCE values (in memory for now)

// Auth0 config
const auth0Config = {
  authRequired: false,
  auth0Logout: true,  
  secret: process.env.SESSION_SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  //clientSecret: process.env.SESSION_SECRET, // no funciona con este

  authorizationParams: {
    //response_type: 'token', // doesn't work, but sh b access token, acc to "https://community.auth0.com/t/id-token-not-present-in-tokenset-when-logging-in-with-passwordless-embedded-login-email-magic-link/137507"    
    //response_type: 'code id_token token',
    //response_type: 'code id_token',
    response_type: 'code',

    //scope: 'openid profile email'
    
    //scope: 'openid profile email api:access'
    scope: 'openid profile email request:llm', // LLM scope
    audience: 'gpt api test' // My API identifier
  },
};

// Temp - Still getting the encrypted token even with the new API configuration?
// app.use((req, res, next) => {
//   if (req.headers.authorization) {
//       // console.log("Incoming token structure:");
//       const token = req.headers.authorization.split(' ')[1];
//       // console.log("- Parts:", token.split('.').length);
//       // console.log("- Starts with:", token.substring(0, 30));

//       // console.log("=== TOKEN FLOW ANALYSIS - SERVER MIDDLEWARE ===");      
//       //   console.log("Token at middleware entry:");
//       //   console.log("- Parts:", token.split('.').length);
//       //   console.log("- Header:", token.split('.')[0]);
//       //   console.log("- First part decoded:", 
//       //       Buffer.from(token.split('.')[0], 'base64').toString());
//   }
//   next();
// });

// A: This needs to stay here, before setupRoutes(), where it is used... but also before MAIN EXECUTIOn , for some reason
const validateJwtMiddleware = validateAuth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256'
});

// 3. MAIN EXECUTION
console.log(`Hello from the server`); // Executed when the file is first run
startServer();

// 4. FUNCTION DEFINITIONS
function setupMiddleware() {
  
  // Authentication middleware
  
  // Session middleware - sets up session management for maintaining user state
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,    
    cookie: { 
      secure: process.env.NODE_ENV === 'production' // sent only over secure HTTPS connections (in production)      
    }
  }));

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

// Protection middleware function (keep before setupRoutes())
function requiresAuth(req, res, next) {
  if (!req.oidc || !req.oidc.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function setupRoutes() {
  const baseLlmPath = '/my-llp-endpoint';

  // Auth middleware for base routes
  app.use(auth(auth0Config));

  // Define a route
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app', 'index.html')); // Serve the HTML file
  });


  // Auth0 routes

  // Test route
  // will return the user's profile information when they log in
  app.get('/profile', (req, res) => {
    console.log("\n# endpoint '/profile'");
    //console.log('Request headers (/profile):', req.headers);    
    console.log('   !T! req.oidc.idToken (/profile):', req.oidc.idToken);  
    console.log('   req.oidc.user (/profile):', req.oidc.user); 
    //console.log('req.oidc.idTokenClaims:', req.oidc.idTokenClaims);
    console.log('   req.oidc.isAuthenticated (/profile):', req.oidc.isAuthenticated);
    if (req.oidc.isAuthenticated) console.log('      yes'); else console.log('      no');

    

    // Print the complete oidc object including the properties returned by getters
    const oidcData = {
      idToken: req.oidc.idToken,
      refreshToken: req.oidc.refreshToken,
      accessToken: req.oidc.accessToken,
      idTokenClaims: req.oidc.idTokenClaims,
      user: req.oidc.user
    };    
    console.log('! req.oidc complete object! (/profile):', util.inspect(oidcData, { depth: null, showHidden: true }));
   


    console.log("#");

    res.send(JSON.stringify(req.oidc.user));
  });

  // Login endpoint
  // initiates the Auth0 login process
  // This line sets up what happens when the server gets a request to the '/my_login' URL.
  // When someone tries to visit the '/my_login' URL, this is the starting point for logging them in.    
  // /my_login endpoint - STARTS the login process  
  // NEW 12dec (1)
  app.get('/my_login', async (req, res) => {
    console.log("\n=== MY_LOGIN REQUEST ANALYSIS ===");
    console.log("Is Auth Code present:", !!req.query.code);
    console.log("Is State present:", !!req.query.state);
    console.log("Is already authenticated:", !!req.oidc?.isAuthenticated());
    console.log("Complete query:", req.query);

    // Add oidc object inspection
    if (req.oidc?.isAuthenticated()) {
        console.log("Already authenticated, inspecting tokens:");
        console.log("OIDC Object Keys:", Object.keys(req.oidc));
        console.log("ID Token present:", !!req.oidc.idToken);
        console.log("Access Token present:", !!req.oidc.accessToken);
        console.log("Raw OIDC:", JSON.stringify(req.oidc, null, 2));
        
        // Use getter properties instead of direct access
        const idToken = req.oidc?.idToken;
        const accessToken = req.oidc?.accessToken?.access_token; // Extract actual token string from accessToken object
                
        console.log("Token extraction details:");
        console.log("- ID Token present:", !!idToken);
        console.log("- Access Token present:", !!accessToken);
        
        console.log("Extracted tokens:");
        console.log("- ID Token:", idToken?.substring(0, 20) + "...");
        console.log(`(Number of parts: ${ idToken.split(".").length })`);
        
        // Type check for accessToken (to avoid "accessToken?.substring is not a function" error if not a string)
        if (typeof accessToken === 'string') {
          console.log("- Access Token:", accessToken.substring(0, 20) + "...");
          console.log(`(Number of parts: ${ accessToken.split(".").length })`);
        } else {
          console.log("- Access Token is not a string. Actual value:", accessToken);
        }        

        if (!idToken || !accessToken) {
          console.log("Missing required tokens:", { idToken: !!idToken, accessToken: !!accessToken });
          return res.status(400).send('Missing required tokens');
        } 

        const unityUrl = `http://localhost:5222?id_token=${idToken}&access_token=${accessToken}`;
        //console.log("Unity redirect URL:", unityUrl);
        console.log("Unity redirect URL (first 50 chars):", unityUrl.substring(0, 50) + "...");
        return res.redirect(unityUrl);
    } else {
        console.log("\n=== STARTING NEW LOGIN ===");
        const { verifier, challenge } = generatePKCE();
        const state = crypto.randomBytes(16).toString('hex');
        
        console.log("Generated PKCE values:");
        console.log("- State:", state);
        console.log("- Challenge:", challenge);
        
        pkceStore[state] = verifier;
        console.log("Stored verifier for state");

        console.log("\n=== REDIRECTING TO AUTH0 ===");
        const loginParams = { 
            returnTo: `${process.env.BASE_URL}/my_login`,
            authorizationParams: {
                code_challenge: challenge,
                code_challenge_method: 'S256',
                state: state
            }
        };
        console.log("Login params:", loginParams);
        res.oidc.login(loginParams);
    }
  });

  // /callback endpoint - HANDLES the response from Auth0
  app.get('/callback', async (req, res) => {
    console.log("### Callback endpoint reached");
    console.log("Query parameters:", req.query);
    
    const code = req.query.code;
    if (!code) {
        console.log("No auth code received");
        return res.status(400).send('No code received');
    }

    try {
        const tokenResponse = await axios.post(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
            grant_type: 'authorization_code',
            client_id: process.env.AUTH0_CLIENT_ID,
            client_secret: process.env.AUTH0_CLIENT_SECRET,
            code: code,
            redirect_uri: `${process.env.BASE_URL}/callback`  // Must match the callback URL
        });

        console.log("Token exchange response:", tokenResponse.data);
        const accessToken = tokenResponse.data.access_token;
        const idToken = tokenResponse.data.id_token;

        // Redirect back to Unity with tokens
        const unityUrl = `http://localhost:5222?id_token=${idToken}&access_token=${accessToken}`;
        res.redirect(unityUrl);
    } catch (error) {
        console.error('Token exchange error:', error.response?.data || error.message);
        res.status(500).send('Token exchange failed');
    }
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
    if (req.oidc.isAuthenticated()) {
      console.log('   req.oidc.accessToken (/token)', req.oidc.accessToken);
      
      console.log("#");

      res.json({ access_token: req.oidc.accessToken });      

    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }    
  });

  // Token refresh endpoint
  // refreshes the access token
  // (meaning to obtain  new access token w/o requiring  user to log in again)
  app.post('/refresh-token', async (req, res) => {
    console.log('# Inside /refresh-token endpoint');

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

      console.log("#");

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
  //app.post(`${baseLlmPath}/completions`, auth({...config, authRequired: true}), handleCompletionRequest);
  //app.post(`${baseLlmPath}/completions`, requiresAuth, handleCompletionRequest); // with custom authorization protection
  app.post(`${baseLlmPath}/completions`, validateJwtMiddleware, handleCompletionRequest);

  // For fetching available models
  //app.get(`${baseLlmPath}/available-models`, handleAvailableModelsRequest);
  //app.get(`${baseLlmPath}/available-models`, requiresAuth, handleAvailableModelsRequest); // with custom authorization protection
  app.get(`${baseLlmPath}/available-models`, validateJwtMiddleware, handleAvailableModelsRequest);


  app.use(errorHandler);
}

async function handleAvailableModelsRequest(req, res, next) {
  console.log("# Received request for available models");

  try {
    const OPENAI_API_KEY_VALUE = readFileContents("OPENAI_API_KEY");
    
     // For debugging, log that we're about to make a request to OpenAI
     console.log("   Fetching models from OpenAI...");

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

    console.log('#');

    res.json(data);

  } catch (error) {
    console.error(error);
    next(new Error('Unable to fetch available models. Error: ' + error.message));
  }
}

async function handleCompletionRequest(req, res, next) { // Error handling as per Fer's system -"Next"- (1/3)
  
  console.log("\n=== LLM API Request ===");   
  
  // Authorization status check
  console.log("\nAuthorization Check:");
  if (!req.auth) {
      console.log("❌  Request not authenticated - no auth info");
      return res.status(401).json({ error: 'Not authenticated' });
  } else {
    console.log("✔️  Request authenticated");
  }

  // Direct access to payload scope:
  // Claude: access  scope directly from payload instead of relying on middleware's processing
  // (A: which doesn't seem to work)
  const payloadScope = req.auth.payload.scope || '';  
  const scopes = payloadScope.split(' ');  
  console.log("Token payload scope:", payloadScope);
  console.log("Parsed scopes:", scopes);  

  const canAccessLlm = scopes.includes('request:llm');
  console.log(`Auth Status: ${canAccessLlm ? '✔️  Authorized for LLM' : '❌  Not authorized for LLM'}`);  
  
  if (!canAccessLlm) {
      return res.status(403).json({ 
          error: 'Not authorized for LLM access',
          detail: 'Missing required permission: request:llm'
      });
  }
  // A: Authenticated AND authorized to make the LLM request!
  else {
    console.log("");
    console.log("---------------------------------");          

    const authHeader = req.headers.authorization;
    
    // Detailed auth header logging
    console.log("Auth header present:", !!authHeader);
    console.log("Auth header starts with 'Bearer':", authHeader?.startsWith('Bearer '));
      
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const tokenPrev = authHeader.split(' ')[1];

    // New JWT token details logging
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
        const tokenParts = token.split('.');
        console.log("Token info:");
        console.log(`- Type: Client Credentials JWT`);
        console.log(`- Parts: ${tokenParts.length}`);
        try {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            console.log(`- Client ID: ${payload.sub}`);
            console.log(`- Audience: ${payload.aud}`);
        } catch (e) {
            console.log("Error decoding token payload");
        }
    }

    // Request details
    console.log("\nRequest details:");
    console.log(`Messages: ${req.body.Messages.length}`);
    console.log(`Model: ${req.body.Model}`);
    console.log(`Provider: ${req.body.SLlpProvider}`);

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
            console.log("---------------------------------");          
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
      console.log("Error sent to Unity (from handleCompletionRequest: '" + error + "'");
      next(error);
    }
  }

  console.log("\n=== end LLM API Request ===");   
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
  console.log("# Inside error -Next- middleware for handling errors");
  
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    status: err.status || 500
  });

  console.log('#');

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

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256')
      .update(verifier)
      .digest('base64url');
  return { verifier, challenge };
}