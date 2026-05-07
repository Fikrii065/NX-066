'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');
const digi   = require('../lib/digiflazz');

router.get('/', async (req,res) => {
  try {
    const [rows] = await db.query("SELECT key_name,value FROM settings WHERE key_name IN ('site_name','site_tagline','site_logo','footer_text','primary_color')");
    res.json({success:true,settings:Object.fromEntries(rows.map(r=>[r.key_name,r.value]))});
  } catch(e){res.status(500).json({success:false});}
});

router.get('/admin', auth, async (req,res) => {
  try {
    const [rows] = await db.query('SELECT key_name,value FROM settings');
    res.json({success:true,settings:Object.fromEntries(rows.map(r=>[r.key_name,r.value]))});
  } catch(e){res.status(500).json({success:false});}
});

router.post('/admin', auth, async (req,res) => {
  try {
    for (const [k,v] of Object.entries(req.body)) {
      await db.query('INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',[k,v,v]);
    }
    res.json({success:true,message:'Pengaturan disimpan'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

router.get('/admin/saldo', auth, async (req,res) => {
  try {
    const saldo = await digi.getSaldo();
    res.json({success:true,saldo});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

router.get('/admin/payment-methods', auth, async (req,res) => {
  try {
    const tokopay = require('../lib/tokopay');
    const methods = await tokopay.getPaymentMethods();
    res.json({success:true,methods});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

module.exports = router;
