const fetch = require('node-fetch');

const API_KEY = process.env.GHL_API_KEY; // I'll assume I can read it, or hardcode it.
// Actually I'll hardcode it from the previous curl command to be safe/fast.
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJsb2NhdGlvbl9pZCI6Ik55ZmNDaXdVTWRtWGFmblVNTUw4IiwidmVyc2lvbiI6MSwiaWF0IjoxNzY3NDYyNjQ3NDcxLCJzdWIiOiJ0RXVjQ1dQcnJmbDFROEhpR3ZSYiJ9.D8rbT-GiMG1PY7FSViwb2MP6iH0CTtTqgzPuzStn6Lw";
const URL = "https://rest.gohighlevel.com/v1/custom-fields/";

async function getFields() {
    const response = await fetch(URL, {
        headers: {
            'Authorization': `Bearer ${KEY}`
        }
    });
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
}

getFields();
