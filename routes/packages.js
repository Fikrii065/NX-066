'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

router.get('/admin', auth, async (req,res) => {
  try {
    const { game_id } = req.query;
    let q = 'SELECT p.*,g.name AS game_name FROM packages p JOIN games g ON g.id=p.game_id';
    const params = [];
    if (game_id) { q+=' WHERE p.game_id=?'; params.push(game_id); }
    q += ' ORDER BY p.sort_order,p.sell_price';
    const [rows] = await db.query(q,params);
    res.json({success:true,packages:rows});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

router.post('/admin', auth, async (req,res) => {
  try {
    const {game_id,game_code,name,sku,base_price,sell_price,is_active,is_flash,notes,sort_order} = req.body;
    await db.query('INSERT INTO packages (game_id,game_code,name,sku,base_price,sell_price,is_active,is_flash,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [game_id,game_code,name,sku,base_price||0,sell_price||0,is_active?1:0,is_flash?1:0,notes||'',sort_order||0]);
    res.json({success:true,message:'Paket berhasil ditambah'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

router.put('/admin/:id', auth, async (req,res) => {
  try {
    const {name,sku,base_price,sell_price,is_active,is_flash,notes,sort_order} = req.body;
    await db.query('UPDATE packages SET name=?,sku=?,base_price=?,sell_price=?,is_active=?,is_flash=?,notes=?,sort_order=? WHERE id=?',
      [name,sku,base_price||0,sell_price||0,is_active?1:0,is_flash?1:0,notes||'',sort_order||0,req.params.id]);
    res.json({success:true,message:'Paket diupdate'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

router.delete('/admin/:id', auth, async (req,res) => {
  try {
    await db.query('DELETE FROM packages WHERE id=?',[req.params.id]);
    res.json({success:true,message:'Paket dihapus'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Bulk update harga dari Digiflazz
router.post('/admin/bulk-import', auth, async (req,res) => {
  try {
    const { game_id, game_code, products, markup_pct } = req.body;
    const markup = parseFloat(markup_pct)||0;
    let imported=0;
    for (const p of products) {
      const sellPrice = Math.ceil(p.price * (1 + markup/100));
      await db.query(`INSERT INTO packages (game_id,game_code,name,sku,base_price,sell_price,is_active,sort_order)
        VALUES (?,?,?,?,?,?,1,0) ON DUPLICATE KEY UPDATE name=?,base_price=?,sell_price=?`,
        [game_id,game_code,p.product_name,p.buyer_sku_code,p.price,sellPrice,p.product_name,p.price,sellPrice]);
      imported++;
    }
    res.json({success:true,message:`${imported} paket berhasil diimport`});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

module.exports = router;
