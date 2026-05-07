'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const digi   = require('../lib/digiflazz');
const fonnte = require('../lib/fonnte');

router.post('/tokopay', async (req,res) => {
  try {
    console.log('[Webhook Tokopay]', JSON.stringify(req.body));
    const order_id = req.body.order_id||req.body.reff_id||req.body.ref_id||req.body.kode_unik;
    const status   = req.body.status||req.body.payment_status||req.body.trx_status;
    if (!order_id) return res.status(400).json({success:false,message:'order_id tidak ada'});

    const [[order]] = await db.query('SELECT * FROM orders WHERE order_id=?',[order_id]);
    if (!order) return res.status(404).json({success:false,message:'Order tidak ditemukan'});
    if (order.payment_status==='paid') return res.json({success:true,message:'Already processed'});

    const isPaid    = ['Success','success','PAID','paid','settlement','00'].includes(String(status));
    const isExpired = ['Expired','expired','EXPIRED','CANCEL','cancel','failure','FAILURE'].includes(String(status));

    if (isPaid) {
      await db.query("UPDATE orders SET payment_status='paid',paid_at=NOW() WHERE order_id=?",[order_id]);
      // Notif WA ke pembeli saja
      if (order.customer_wa) {
        fonnte.notifyBuyer(order.customer_wa, fonnte.orderPaidBuyer(order)).catch(()=>{});
      }
      processTopup(order).catch(e=>console.error('[Topup]',e.message));
    } else if (isExpired) {
      await db.query("UPDATE orders SET payment_status='expired' WHERE order_id=?",[order_id]);
    }
    res.json({success:true});
  } catch(e){console.error('[Webhook]',e.message);res.status(500).json({success:false});}
});

router.post('/digiflazz', async (req,res) => {
  try {
    const d = req.body.data || req.body;
    const orderId = d.ref_id;
    if (!orderId) return res.json({success:true});
    const status = d.status==='Sukses'?'success':d.status==='Gagal'?'failed':'processing';
    await db.query('UPDATE orders SET topup_status=?,sn=?,digiflazz_ref=?,completed_at=? WHERE order_id=?',
      [status,d.sn||null,d.trx_id||null,status==='success'?new Date():null,orderId]);
    const [[order]] = await db.query('SELECT * FROM orders WHERE order_id=?',[orderId]);
    if (order?.customer_wa) {
      if (status==='success') {
        fonnte.notifyBuyer(order.customer_wa, fonnte.orderSuccessBuyer({...order,sn:d.sn})).catch(()=>{});
      } else if (status==='failed') {
        fonnte.notifyBuyer(order.customer_wa, fonnte.orderFailedBuyer(order)).catch(()=>{});
      }
    }
    res.json({success:true});
  } catch(e){res.status(500).json({success:false});}
});

async function processTopup(order) {
  try {
    await db.query("UPDATE orders SET topup_status='processing' WHERE order_id=?",[order.order_id]);
    const customerNo = order.zone_id ? `${order.customer_no}/${order.zone_id}` : order.customer_no;
    const result = await digi.topup(order.order_id, order.sku, customerNo);
    const status = result.status==='Sukses'?'success':result.status==='Gagal'?'failed':'processing';
    await db.query('UPDATE orders SET topup_status=?,sn=?,digiflazz_ref=?,completed_at=? WHERE order_id=?',
      [status,result.sn||null,result.trx_id||null,status==='success'?new Date():null,order.order_id]);
    if (order.customer_wa) {
      if (status==='success') fonnte.notifyBuyer(order.customer_wa, fonnte.orderSuccessBuyer({...order,sn:result.sn})).catch(()=>{});
      else if (status==='failed') fonnte.notifyBuyer(order.customer_wa, fonnte.orderFailedBuyer(order)).catch(()=>{});
    }
  } catch(e){
    await db.query("UPDATE orders SET topup_status='failed' WHERE order_id=?",[order.order_id]);
    if (order.customer_wa) fonnte.notifyBuyer(order.customer_wa, fonnte.orderFailedBuyer(order)).catch(()=>{});
  }
}

module.exports = router;
