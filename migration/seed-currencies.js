/** Seed all ISO 4217 world currencies into AdminCurrencyInfo (skips existing), set company currency to QAR. */
const mysql = require('mysql2/promise');

const WORLD = [
  ['AFN','Afghan Afghani','؋'],['ALL','Albanian Lek','L'],['DZD','Algerian Dinar','دج'],['AOA','Angolan Kwanza','Kz'],
  ['ARS','Argentine Peso','$'],['AUD','Australian Dollar','A$'],['AZN','Azerbaijani Manat','₼'],['BSD','Bahamian Dollar','B$'],
  ['BRL','Brazilian Real','R$'],['GBP','British Pound','£'],['BND','Brunei Dollar','B$'],['BGN','Bulgarian Lev','лв'],
  ['BIF','Burundian Franc','FBu'],['KHR','Cambodian Riel','៛'],['XAF','Central African CFA Franc','FCFA'],
  ['CLP','Chilean Peso','$'],['CNY','Chinese Yuan','¥'],['COP','Colombian Peso','$'],['KMF','Comorian Franc','CF'],
  ['CDF','Congolese Franc','FC'],['CRC','Costa Rican Colon','₡'],['HRK','Croatian Kuna','kn'],['CZK','Czech Koruna','Kč'],
  ['DKK','Danish Krone','kr'],['DJF','Djiboutian Franc','Fdj'],['DOP','Dominican Peso','RD$'],['EGP','Egyptian Pound','E£'],
  ['ERN','Eritrean Nakfa','Nfk'],['EUR','Euro','€'],['FJD','Fijian Dollar','FJ$'],['GMD','Gambian Dalasi','D'],
  ['GEL','Georgian Lari','₾'],['GHS','Ghanaian Cedi','₵'],['GTQ','Guatemalan Quetzal','Q'],['GNF','Guinean Franc','FG'],
  ['HTG','Haitian Gourde','G'],['HNL','Honduran Lempira','L'],['HKD','Hong Kong Dollar','HK$'],['HUF','Hungarian Forint','Ft'],
  ['ISK','Icelandic Krona','kr'],['IDR','Indonesian Rupiah','Rp'],['IRR','Iranian Rial','﷼'],['IQD','Iraqi Dinar','ع.د'],
  ['ILS','Israeli New Shekel','₪'],['JMD','Jamaican Dollar','J$'],['JPY','Japanese Yen','¥'],['JOD','Jordanian Dinar','JD'],
  ['KZT','Kazakhstani Tenge','₸'],['KES','Kenyan Shilling','KSh'],['KWD','Kuwaiti Dinar','KD'],['KGS','Kyrgystani Som','с'],
  ['LAK','Lao Kip','₭'],['LBP','Lebanese Pound','ل.ل'],['LSL','Lesotho Loti','L'],['LRD','Liberian Dollar','L$'],
  ['LYD','Libyan Dinar','LD'],['MOP','Macanese Pataca','MOP$'],['MKD','Macedonian Denar','ден'],['MGA','Malagasy Ariary','Ar'],
  ['MYR','Malaysian Ringgit','RM'],['MVR','Maldivian Rufiyaa','Rf'],['MRU','Mauritanian Ouguiya','UM'],
  ['MUR','Mauritian Rupee','₨'],['MXN','Mexican Peso','Mex$'],['MDL','Moldovan Leu','L'],['MNT','Mongolian Togrog','₮'],
  ['MAD','Moroccan Dirham','د.م.'],['MZN','Mozambican Metical','MT'],['MMK','Myanmar Kyat','K'],['NAD','Namibian Dollar','N$'],
  ['NZD','New Zealand Dollar','NZ$'],['NIO','Nicaraguan Cordoba','C$'],['NOK','Norwegian Krone','kr'],['OMR','Omani Rial','ر.ع.'],
  ['PAB','Panamanian Balboa','B/.'],['PGK','Papua New Guinean Kina','K'],['PYG','Paraguayan Guarani','₲'],
  ['PEN','Peruvian Sol','S/'],['PLN','Polish Zloty','zł'],['RON','Romanian Leu','lei'],['RUB','Russian Ruble','₽'],
  ['RWF','Rwandan Franc','FRw'],['SAR','Saudi Riyal','﷼'],['RSD','Serbian Dinar','дин'],['SCR','Seychellois Rupee','₨'],
  ['SLE','Sierra Leonean Leone','Le'],['SGD','Singapore Dollar','S$'],['SOS','Somali Shilling','Sh'],
  ['KRW','South Korean Won','₩'],['SSP','South Sudanese Pound','SS£'],['LKR','Sri Lankan Rupee','Rs'],
  ['SEK','Swedish Krona','kr'],['CHF','Swiss Franc','CHF'],['SYP','Syrian Pound','S£'],['TWD','Taiwan Dollar','NT$'],
  ['TJS','Tajikistani Somoni','SM'],['TZS','Tanzanian Shilling','TSh'],['THB','Thai Baht','฿'],['TOP','Tongan Paanga','T$'],
  ['TTD','Trinidad and Tobago Dollar','TT$'],['TND','Tunisian Dinar','د.ت'],['TRY','Turkish Lira','₺'],
  ['TMT','Turkmenistani Manat','m'],['UAH','Ukrainian Hryvnia','₴'],['UYU','Uruguayan Peso','$U'],
  ['UZS','Uzbekistani Som','soʻm'],['VES','Venezuelan Bolivar','Bs.'],['VND','Vietnamese Dong','₫'],
  ['XOF','West African CFA Franc','CFA'],['YER','Yemeni Rial','﷼'],['ZMW','Zambian Kwacha','ZK'],['ZWL','Zimbabwean Dollar','Z$'],
];

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [existing] = await c.query('SELECT TRIM(CurrShortName) AS s FROM AdminCurrencyInfo');
  const have = new Set(existing.map((r) => r.s.toUpperCase()));
  const [[{ next }]] = await c.query('SELECT IFNULL(MAX(CurrencyCode),0)+1 AS next FROM AdminCurrencyInfo');
  let code = next, added = 0;
  for (const [sh, name, sym] of WORLD) {
    if (have.has(sh.toUpperCase())) continue;
    await c.query(
      'INSERT INTO AdminCurrencyInfo (CurrencyCode, CurrShortName, CurrName, Symbol, RateWrtHC, CurntUserCode) VALUES (?,?,?,?,1,1)',
      [code++, sh, name, sym]);
    added++;
  }
  // default the company currency to QAR
  const [[qar]] = await c.query("SELECT CurrencyCode FROM AdminCurrencyInfo WHERE TRIM(CurrShortName)='QAR' LIMIT 1");
  await c.query('UPDATE AdminCompanyInfo SET HCurrencyCode = ?', [qar.CurrencyCode]);
  const [[{ total }]] = await c.query('SELECT COUNT(*) AS total FROM AdminCurrencyInfo');
  console.log(`added ${added} currencies (total ${total}); company currency set to QAR (code ${qar.CurrencyCode})`);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
