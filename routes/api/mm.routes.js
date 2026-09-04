import { Router } from 'express';
import { postGoodsReceipt } from '../../services/goodsReceipt.service.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

const router = Router();

router.post('/goods-receipts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await postGoodsReceipt(req.body);
    return res.status(201).json({
      success: true,
      message: 'Goods Receipt berhasil diposting - stock WM bertambah dan jurnal FI dibuat',
      data: result,
    });
  } catch (err) {
    console.error('[gr]', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Duplikat nomor GR - transaksi sudah pernah diposting' });
    }
    return res.status(400).json({ success: false, error: err.message ?? 'Gagal memproses Goods Receipt' });
  }
});

router.get('/goods-receipts/:id', requireAuth, async (req, res) => {
  const { queryOne } = await import('../../config/db.js');
  const gr = await queryOne(
    `SELECT g.*, je.je_number, je.status AS je_status
       FROM goods_receipts g
       LEFT JOIN journal_entries je ON je.id = g.journal_entry_id
      WHERE g.id = ?`,
    [req.params.id],
  );
  if (!gr) return res.status(404).json({ success: false, error: 'Goods Receipt tidak ditemukan' });
 const items = await queryOne(
    `SELECT gi.*, m.material_code, m.name AS material_name, s.code AS storage_code
       FROM goods_receipt_items gi
       JOIN materials m ON m.id = gi.material_id
       JOIN storage_locations s ON s.id = gi.storage_location_id
      WHERE gi.goods_receipt_id = ?`,
    [gr.id],
  );
  const ledger = await queryOne(
    `SELECT * FROM stock_ledger
      WHERE reference_doc_type = 'GOODS_RECEIPT' AND reference_doc_id = ?`,
    [gr.id],
  );
  res.json({ success: true, data: { header: gr, items, ledger } }) ;
});

export default router;
