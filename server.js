// Import required modules
const express = require('express');
const path = require('path'); // Added to handle file paths
require('dotenv').config() // For using environment variables

// Create an instance of Express
const app = express();

// Serve static files from the app directory
app.use(express.static(path.join(__dirname, 'app'))); // Added to serve static files

// Define a route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html')); // Changed to send the HTML file
  //res.send('Hello, world from the server!');
});

const OPENAI_API_KEY_VALUE = readFileContents("OPENAI_API_KEY");

app.get('/my-gpt-endpoint/:message', async (req, res) => {
  
  const myText = req.params.message;
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
                model: 'gpt-4',
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
  }  

  // Send the response to the client
  res.send(openAiResponseToShow);
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
  console.log('Go to http://localhost:' + PORT)
});

