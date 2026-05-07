'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../lib/db');
const SECRET  = process.env.JWT_SECRET || 'topupgame_secret';

router.post('/login', async (req,res) => {
  try {
    const { username, password } = req.body;
    if (!username||!password) return res.status(400).json({success:false,message:'Lengkapi data'});
    const [[admin]] = await db.query('SELECT * FROM admins WHERE username=? LIMIT 1',[username]);
    if (!admin) return res.status(401).json({success:false,message:'Username/password salah'});
    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({success:false,message:'Username/password salah'});
    const token = jwt.sign({id:admin.id,username:admin.username}, SECRET, {expiresIn:'7d'});
    res.json({success:true,token});
  } catch(e) { res.status(500).json({success:false,message:e.message}); }
});

router.post('/change-password', require('../middleware/auth'), async (req,res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const [[admin]] = await db.query('SELECT * FROM admins WHERE id=?',[req.admin.id]);
    const ok = await bcrypt.compare(oldPassword, admin.password);
    if (!ok) return res.status(400).json({success:false,message:'Password lama salah'});
    const hash = await bcrypt.hash(newPassword,10);
    await db.query('UPDATE admins SET password=? WHERE id=?',[hash,req.admin.id]);
    res.json({success:true,message:'Password berhasil diubah'});
  } catch(e) { res.status(500).json({success:false,message:e.message}); }
});

module.exports = router;
