/* Instalments-due endpoint, on throwaway invoices it removes afterwards. */
const BASE='http://localhost:5001';
require('dotenv').config();
const jwt=require('jsonwebtoken'); const {query,pool}=require('./src/db'); const {createSession}=require('./src/sessionStore');
let token='',fails=0;
const ok=(n,p,d='')=>{if(!p)fails++;console.log(`${p?'PASS':'FAIL'}  ${n}${d?` — ${d}`:''}`);};
const call=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:b&&JSON.stringify(b)});return{status:r.status,body:await r.json().catch(()=>({}))};};
const iso=(d)=>d.toISOString().slice(0,10);
const day=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return iso(d);};
(async()=>{
  const [u]=await query("SELECT * FROM app_users WHERE role='Super Admin' AND active=1 LIMIT 1");
  const jti=await createSession(u.id,'127.0.0.1','inst-test');
  token=jwt.sign({id:u.id,username:u.username,name:u.display_name,role:u.role,jti},process.env.JWT_SECRET,{expiresIn:'5m'});
  const made=[];
  try{
    const base=(await call('GET','/api/dashboard/instalments?scope=overdue')).body.totals;

    // invoice A: 3 x 100 — one overdue, one in 3 days, one in 20 days
    const a=await call('POST','/api/invoices',{customerName:'ZZ TEST inst A',invoiceDate:day(-60),amount:300,discountAmount:0});
    made.push(a.body.invoiceCode);
    await call('POST',`/api/invoices/${a.body.invoiceCode}/approve`,{status:'Approved'});
    const r=await call('POST',`/api/invoices/${a.body.invoiceCode}/plan`,{lines:[{dueDate:day(-10),amount:100},{dueDate:day(3),amount:100},{dueDate:day(20),amount:100}]});
    ok('plan created on test invoice', r.status===200, r.body.error||'');

    let d=(await call('GET','/api/dashboard/instalments?scope=overdue')).body;
    ok('overdue count went up by one', d.totals.overdue.count===base.overdue.count+1, `${base.overdue.count} -> ${d.totals.overdue.count}`);
    ok('overdue amount went up by 100', d.totals.overdue.amount===base.overdue.amount+100, `+${d.totals.overdue.amount-base.overdue.amount}`);
    ok('next 7 days picked up the 3-day one', d.totals.week.count===base.week.count+1, `${base.week.count} -> ${d.totals.week.count}`);
    ok('next 30 days picked up both future ones', d.totals.month.count===base.month.count+2, `${base.month.count} -> ${d.totals.month.count}`);
    const mine=d.rows.find(x=>x.InvoiceCode===a.body.invoiceCode);
    ok('overdue row reports days late', mine && Number(mine.daysLate)===10, mine?`${mine.daysLate}d`:'row missing');
    ok('overdue row shows the full amount outstanding', mine && Number(mine.outstanding)===100, mine?`${mine.outstanding}`:'-');

    // paying it should drop it out of overdue
    await call('POST','/api/receipts',{invoiceCode:a.body.invoiceCode,receivedAmount:100,receiptDate:day(-1)});
    d=(await call('GET','/api/dashboard/instalments?scope=overdue')).body;
    ok('a paid instalment leaves the overdue list', d.totals.overdue.count===base.overdue.count, `${d.totals.overdue.count}`);

    // a part payment leaves only the remainder owing
    await call('POST','/api/receipts',{invoiceCode:a.body.invoiceCode,receivedAmount:40,receiptDate:day(0)});
    d=(await call('GET','/api/dashboard/instalments?scope=month')).body;
    const part=d.rows.find(x=>x.InvoiceCode===a.body.invoiceCode);
    ok('part-paid instalment shows only what is left', part && Number(part.outstanding)===60, part?`${part.outstanding}`:'row missing');

    // an invoice edit makes the plan stale -> excluded, but counted
    const beforeStale=(await call('GET','/api/dashboard/instalments?scope=month')).body;
    await query('UPDATE UmrahInvoice SET NetAmount=400, Amount=400 WHERE InvoiceCode=?',[a.body.invoiceCode]);
    d=(await call('GET','/api/dashboard/instalments?scope=month')).body;
    ok('a stale plan drops out of the due list',
      d.totals.month.count===beforeStale.totals.month.count-2, `${beforeStale.totals.month.count} -> ${d.totals.month.count}`);
    ok('…but is counted so it is not invisible', d.staleCount>=1, `staleCount ${d.staleCount}`);
  } finally {
    for(const c of made){
      await query('DELETE FROM payment_plan_dtl WHERE invoice_code=?',[c]);
      await query('DELETE FROM payment_plan WHERE invoice_code=?',[c]);
      await query('DELETE FROM UmrahReciept WHERE InvoiceCode=?',[c]);
      await query('DELETE FROM UmrahPassengers WHERE InvoiceCode=?',[c]);
      await query('DELETE FROM UmrahInvoice WHERE InvoiceCode=?',[c]);
    }
    console.log('cleaned up throwaway invoices', made.join(',')||'(none)');
    await pool.end();
  }
  console.log(fails?`\n${fails} FAILED`:'\nall passed');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
