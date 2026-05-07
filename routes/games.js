'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// Public: daftar game aktif
router.get('/', async (req,res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE is_active=1 ORDER BY sort_order,name');
    res.json({success:true,games:rows});
  } catch(e){res.status(500).json({success:false});}
});

// Public: detail game + packages
router.get('/:code', async (req,res) => {
  try {
    const [[game]] = await db.query('SELECT * FROM games WHERE code=? AND is_active=1',[req.params.code]);
    if (!game) return res.status(404).json({success:false,message:'Game tidak ditemukan'});
    const [packages] = await db.query('SELECT * FROM packages WHERE game_code=? AND is_active=1 ORDER BY sort_order,sell_price',[req.params.code]);
    res.json({success:true,game,packages});
  } catch(e){res.status(500).json({success:false});}
});

// Admin: semua game
router.get('/admin/all', auth, async (req,res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games ORDER BY sort_order,name');
    res.json({success:true,games:rows});
  } catch(e){res.status(500).json({success:false});}
});

// Admin: tambah game
router.post('/admin', auth, async (req,res) => {
  try {
    const {code,name,category,icon,icon_url,banner_url,is_active,is_trending,sort_order,instructions,fields} = req.body;
    await db.query('INSERT INTO games (code,name,category,icon,icon_url,banner_url,is_active,is_trending,sort_order,instructions,fields) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [code,name,category||'game',icon||'🎮',icon_url||'',banner_url||'',is_active?1:0,is_trending?1:0,sort_order||0,instructions||'',JSON.stringify(fields||[])]);
    res.json({success:true,message:'Game berhasil ditambah'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Admin: edit game
router.put('/admin/:id', auth, async (req,res) => {
  try {
    const {name,category,icon,icon_url,banner_url,is_active,is_trending,sort_order,instructions,fields} = req.body;
    await db.query('UPDATE games SET name=?,category=?,icon=?,icon_url=?,banner_url=?,is_active=?,is_trending=?,sort_order=?,instructions=?,fields=? WHERE id=?',
      [name,category,icon,icon_url||'',banner_url||'',is_active?1:0,is_trending?1:0,sort_order||0,instructions||'',JSON.stringify(fields||[]),req.params.id]);
    res.json({success:true,message:'Game berhasil diupdate'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Admin: hapus game
router.delete('/admin/:id', auth, async (req,res) => {
  try {
    await db.query('DELETE FROM games WHERE id=?',[req.params.id]);
    res.json({success:true,message:'Game dihapus'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Admin: sync produk dari Digiflazz
router.post('/admin/sync-digiflazz', auth, async (req,res) => {
  try {
    const digi = require('../lib/digiflazz');
    const products = await digi.getPricelist('all');
    res.json({success:true,count:products.length,products:products.slice(0,20)});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

module.exports = router;
