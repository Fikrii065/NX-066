'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

router.get('/', async (req,res) => {
  try {
    const [rows] = await db.query('SELECT * FROM banners WHERE is_active=1 ORDER BY sort_order,id');
    res.json({success:true,banners:rows});
  } catch(e){res.status(500).json({success:false});}
});
router.get('/admin', auth, async (req,res) => {
  try {
    const [rows] = await db.query('SELECT * FROM banners ORDER BY sort_order,id');
    res.json({success:true,banners:rows});
  } catch(e){res.status(500).json({success:false});}
});
router.post('/admin', auth, async (req,res) => {
  try {
    const {title,image_url,link_url,is_active,sort_order} = req.body;
    await db.query('INSERT INTO banners (title,image_url,link_url,is_active,sort_order) VALUES (?,?,?,?,?)',
      [title||'',image_url,link_url||'',is_active?1:0,sort_order||0]);
    res.json({success:true,message:'Banner ditambah'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});
router.put('/admin/:id', auth, async (req,res) => {
  try {
    const {title,image_url,link_url,is_active,sort_order} = req.body;
    await db.query('UPDATE banners SET title=?,image_url=?,link_url=?,is_active=?,sort_order=? WHERE id=?',
      [title||'',image_url,link_url||'',is_active?1:0,sort_order||0,req.params.id]);
    res.json({success:true,message:'Banner diupdate'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});
router.delete('/admin/:id', auth, async (req,res) => {
  try {
    await db.query('DELETE FROM banners WHERE id=?',[req.params.id]);
    res.json({success:true,message:'Banner dihapus'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});
module.exports = router;
