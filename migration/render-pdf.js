const fs = require('fs');
(async () => {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf('C:/Users/shifin/Downloads/UmrahReciept (1).pdf', { scale: 4 });
  let i = 0;
  for await (const page of doc) {
    i++;
    fs.writeFileSync(`M:/Travels/migration/receipt-page${i}.png`, page);
    if (i >= 2) break;
  }
  console.log(`rendered ${i} page(s)`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
