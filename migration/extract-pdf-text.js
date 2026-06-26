const fs = require('fs');
const pdf = require('pdf-parse');
pdf(fs.readFileSync('C:/Users/shifin/Downloads/UmrahReciept (1).pdf'))
  .then((d) => console.log(d.text))
  .catch((e) => { console.error(e.message); process.exit(1); });
