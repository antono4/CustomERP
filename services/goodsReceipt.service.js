import pool from '../config/db.js';

/**
 * Goods Receipt service — MM → WM + FI dalam satu transaksi atomik.
 *
 * 1. INSERT header + item goods_receipts (MM)
 * 2. Upsert inventory_stock + append stock_ledger (WM)
 * 3. INSERT jurnal FI: Debit Inventory, Kredit GR/IR Clearing
 * 4. Tautkan goods_receipts.journal_entry_id ke jurnal tsb.
 *
 * Kegagalan di salah satu langkah => rollback seluruh transaksi,
 * sehingga stok dan jurnal selalu konsisten (seamless integration).
 */

const GR_JE_DEBIT_TEXT = 'GR - Penerimaan barang';
const GR_JE_CREDIT_TEXT = 'GR - Kliring AP';

/**
 * Proses Goods Receipt: tambah stok WM + posting jurnal FI.
 * @param {Object} input
 * @param {string} input.gr_number
 * @param {number} [input.purchase_order_id]
 * @param {number} [input.vendor_id]
 * @param {string} input.posting_date  YYYY-MM-DD
 * @param {string} [input.company_code]
 * @param {Array} input.items  [{ material_id, storage_location_id, quantity,unit_price,
 *                                   gl_inventory_account_id,gl_gr_ir_clearing_account_id }]
 * @returns {Promise<{goodsReceiptId:number, journalEntryId:number, stockUpdated:number}>}
 */
export async function postGoodsReceipt(input) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [grHeader] = await conn.execute(
      `INSERT INTO goods_receipts
           (gr_number, purchase_order_id,vendor_id,posting_date,status)
       VALUES (?, ?, ?, ?, 'POSTED')`,
      [input.gr_number,input.purchase_order_id ?? null,input.vendor_id ?? null,input.posting_date],
    );
    const goodsReceiptId = grHeader.insertId;

    for (const item of input.items) {
      await conn.execute(
        `INSERT INTO goods_receipt_items
           (goods_receipt_id,material_id,storage_location_id,quantity,
            unit_price,gl_inventory_account_id,gl_gr_ir_clearing_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [goodsReceiptId,item.material_id,item.storage_location_id,
         item.quantity,item.unit_price,
         item.gl_inventory_account_id,item.gl_gr_ir_clearing_account_id],
      );

      // --- WM: tambah stok (upsert ke inventory_stock) + audit stock_ledger
      await conn.execute(
        `INSERT INTO inventory_stock (material_id,storage_location_id,quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [item.material_id,item.storage_location_id,item.quantity],
      );
      await conn.execute(
        `INSERT INTO stock_ledger
           (material_id,storage_location_id,movement_type,quantity_delta,
            reference_doc_type,reference_doc_id)
         VALUES (?, ?, 'GR', ?, 'GOODS_RECEIPT', ?)`,
        [item.material_id,item.storage_location_id,item.quantity,goodsReceiptId],
      );
    }

    // --- FI: nomor jurnal + header + baris debit/kredit
    const companyCode = input.company_code ?? '1000';
    const jeNumber = await nextJournalNumber(conn,companyCode,input.posting_date);
    const [jeHeader] = await conn.execute(
      `INSERT INTO journal_entries
           (je_number,company_code,posting_date,reference_doc_type,reference_doc_id,status)
       VALUES (?, ?, ?, 'GOODS_RECEIPT', ?, 'POSTED')`,
      [jeNumber,companyCode,input.posting_date,goodsReceiptId],
    );
    const journalEntryId = jeHeader.insertId;

    let lineNo = 1;
    for (const item of input.items) {
      const amount = Number(item.unit_price) * Number(item.quantity);

      // Debit: Inventory
      await conn.execute(
        `INSERT INTO journal_entry_lines
           (journal_entry_id,line_no,posting_key,gl_account_id,amount,material_id,text)
         VALUES (?, ?, 'DEBIT', ?, ?, ?, ?)`,
        [journalEntryId,lineNo++,item.gl_inventory_account_id,amount,item.material_id,
         GR_JE_DEBIT_TEXT],
      );
      // Kredit: GR/IR Clearing
      await conn.execute(
        `INSERT INTO journal_entry_lines
           (journal_entry_id,line_no,posting_key,gl_account_id,amount,material_id,text)
         VALUES (?, ?, 'CREDIT', ?, ?, ?, ?)`,
        [journalEntryId,lineNo++,item.gl_gr_ir_clearing_account_id,amount,item.material_id,GR_JE_CREDIT_TEXT],
      );
    }

    // --- Tautkan FK: goods_receipts.journal_entry_id -> journal_entries.id
    await conn.execute(
      `UPDATE goods_receipts SET journal_entry_id = ? WHERE id = ?`,
      [journalEntryId,goodsReceiptId],
    );

    await conn.commit();

    return { goodsReceiptId,journalEntryId,stockUpdated: input.items.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Alokasi nomor jurnal berurutan per perusahaan + tahun secara atomik. */
async function nextJournalNumber(conn,companyCode,postingDate) {
  const year = postingDate.slice(0,4);
  const prefix = `JE-${companyCode}-${year}-`;
  const [rows] = await conn.execute(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(je_number,LENGTH(?) + 1) AS UNSIGNED))), 0) + 1 AS next_no
       FROM journal_entries
      WHERE je_number LIKE CONCAT(?,'%')`,
    [prefix,`${prefix}%`],
  );
  const nextNo = String(rows[0].next_no).padStart(6,'0');
  return `${prefix}${nextNo}`;
}