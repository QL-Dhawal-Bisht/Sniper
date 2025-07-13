const fs = require('fs');
const path = require('path');

// Directory containing raw text files
const rawDir = path.join(__dirname, 'deepscrape');
const outputDir = path.join(__dirname, 'cleaned_data');

// Create the output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Function to clean the raw data and convert it into a single line
const cleanData = (data) => {
  // Define patterns to remove common headers, sections, and unwanted data
  const unwantedPatterns = [
    /URL:.+/g,  // Remove URL lines
    /PLATFORM:.+/g,  // Remove PLATFORM lines
    /SCRAPED:.+/g,  // Remove SCRAPED lines
    /Reviews/g,  // Remove 'Reviews' section
    /Ratings/g,  // Remove 'Ratings' section
    /Service Lines/g,  // Remove service lines header
    /Project cost/g,  // Remove project cost header
    /Service Provided/g,  // Remove the service header
    /Showing \d+-\d+ of \d+ Reviews/g, // Remove pagination lines
    /Background/g,  // Remove Background section
    /Opportunity/g,  // Remove Opportunity section
    /Solution/g,  // Remove Solution section
    /Results & Feedback/g,  // Remove Results & Feedback section
    /Portfolio & Awards/g,  // Remove Portfolio and Awards section
    /Location/g,  // Remove Location
    /Contact/g,  // Remove Contact section
    /LinkedIn|Facebook|X|Instagram/g,  // Remove social media links
    /Location/g,  // Remove Location section
    /\d{2}-\d{2}-\d{4}/g,  // Remove date-like patterns (e.g., '2025-07-11')
    /\b(?:min|max)\b[\w\s]+/g,  // Remove lines with project size, budgets
  ];

  // Remove unwanted lines based on the patterns
  unwantedPatterns.forEach((pattern) => {
    data = data.replace(pattern, '');
  });

  // Remove extra newlines and whitespace between lines, then combine into one line
  data = data.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

  return data;
};

// Process all text files in the raw data directory
const processFiles = () => {
  fs.readdir(rawDir, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return;
    }

    // Loop through all text files
    files.forEach((file) => {
      if (file.endsWith('.txt') || file.endsWith('.html')) {
        const filePath = path.join(rawDir, file);

        // Read the content of each text file
        fs.readFile(filePath, 'utf-8', (err, data) => {
          if (err) {
            console.error('Error reading file:', file, err);
            return;
          }

          // Clean the data by passing it through the cleanData function
          const cleanedData = cleanData(data);

          // Save the cleaned data into a new file
          const outputFilePath = path.join(outputDir, `cleaned_${file}`);
          fs.writeFile(outputFilePath, cleanedData, 'utf-8', (err) => {
            if (err) {
              console.error('Error writing to file:', outputFilePath, err);
              return;
            }
            console.log(`Cleaned data saved to: ${outputFilePath}`);
          });
        });
      }
    });
  });
};

// Run the file processing
processFiles();
