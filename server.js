// Import required modules
const express = require('express');
const path = require('path'); // Added to handle file paths

// Create an instance of Express
const app = express();

// Serve static files from the app directory
app.use(express.static(path.join(__dirname, 'app'))); // Added to serve static files

// Define a route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html')); // Changed to send the HTML file
  //res.send('Hello, world from the server!');
});

// Define the port for the server to listen on
const PORT = process.env.PORT || 3000;

console.log(`Hello from the server`);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Go to http://localhost:' + PORT)
});